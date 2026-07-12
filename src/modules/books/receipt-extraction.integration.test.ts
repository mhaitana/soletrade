import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { getDataClient } from "@/server/db/client";
import { unwrap, unwrapMaybe, parsePgTimestamp } from "@/server/db/helpers";
import type { Database } from "@/server/db/types";
import { branded, type FileId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createFileRecord } from "@/platform/files";
import { enableModule } from "@/platform/module-installations";
import type { BusEvent } from "@/server/events";

/**
 * Integration tests for the Books receipt-extraction pipeline (Wave 2) against a real
 * Postgres with the **mock** AI provider (no Anthropic/OpenAI key needed). Exercises the
 * full flow: upload a file row → extract (canned data) → review queue → apply (creates a
 * book_transaction with `receiptFileId` + `gstCents`) → idempotent re-apply rejected.
 *
 * `.env.local` sets `AI_PROVIDER=openai` for the dev server; the receipt-extraction
 * service branches on `isMockProvider()` (which reads the `env` singleton parsed once at
 * module load). To force the mock path here we `vi.stubEnv("AI_PROVIDER","mock")` +
 * `vi.resetModules()` and **dynamically** import the service + event bus so `env`
 * re-parses with the stubbed value - the same pattern `platform/ai/provider.test.ts`
 * uses. Setup/cleanup helpers don't touch the AI provider, so they stay top-imported.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

// Dynamically loaded after the env stub - see beforeAll. Typed via `typeof import()`.
type ExtractionService = typeof import("./receipt-extraction");
type EventBus = typeof import("@/server/events");
let svc: ExtractionService;
let bus: EventBus;

describe.skipIf(!HAS_DB)("books receipt extraction (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000e1");
  let ws: WorkspaceId;
  let receiptFileId: FileId;
  /** Captured ReceiptProcessed events (the first emitter of this declared-but-unused event). */
  const capturedEvents: BusEvent[] = [];
  let unsubReceipt: (() => void) | null = null;

  beforeAll(async () => {
    // Force the mock AI provider for this file: stub env, reset the module registry, then
    // dynamically import the service + event bus so `env` re-parses with AI_PROVIDER=mock.
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.resetModules();
    [svc, bus] = await Promise.all([import("./receipt-extraction"), import("@/server/events")]);

    await seedUsers([
      { id: actor, email: "receipt-ext@soletrade-test.local", fullName: "Receipt Ext" },
    ]);
    ws = await createWorkspace(actor, "Receipt Ext One", `receipt-ext-one-${Date.now()}`);
    await enableModule(ws, "books", actor);
    bus.clearEventBus();
    unsubReceipt = bus.onEvent("ReceiptProcessed", (e) => {
      capturedEvents.push(e);
    });
    // Create a file metadata row. The mock provider short-circuits before downloading
    // bytes, so no real Storage upload is needed - only the metadata row exists.
    const file = await createFileRecord({
      workspaceId: ws,
      uploadedByUserId: actor,
      fileName: "receipt.png",
      mimeType: "image/png",
      sizeBytes: 1234,
      entityType: "receipt",
    });
    receiptFileId = file.id;
  });

  afterAll(async () => {
    unsubReceipt?.();
    bus.clearEventBus();
    vi.unstubAllEnvs();
    const workspaceIds = [ws!].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(
      workspaceIds,
      [actor],
      [
        { table: "receipt_extractions" },
        { table: "book_transactions" },
        { table: "files" },
        { table: "audit_logs" },
        { table: "activity_events" },
        { table: "module_installations" },
      ],
    );
  });

  /** CamelCase + branded-id + Date mapper for book_transactions rows (keeps assertions unchanged). */
  type BookTxRow = Database["public"]["Tables"]["book_transactions"]["Row"];

  function mapBookTx(r: BookTxRow) {
    return {
      id: r.id,
      type: r.type,
      category: r.category,
      amountCents: r.amount_cents,
      gstCents: r.gst_cents,
      currency: r.currency,
      customerId: r.customer_id,
      sourceInvoiceId: r.source_invoice_id,
      sourceEarningId: r.source_earning_id,
      description: r.description,
      notes: r.notes,
      date: parsePgTimestamp(r.date),
      receiptFileId: r.receipt_file_id,
    };
  }

  it("extracts canned data, persists a pending row, and publishes ReceiptProcessed", async () => {
    const extractionId = await svc.extractReceipt(ws!, receiptFileId!, actor);

    const row = await svc.getExtraction(ws!, extractionId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("pending");
    expect(row!.modelUsed).toBe("mock");
    expect(row!.errorMessage).toBeNull();
    expect(row!.transactionId).toBeNull();
    expect(row!.extractedData).not.toBeNull();
    expect(row!.extractedData!.merchant).toBe("Mock Merchant");
    expect(row!.extractedData!.totalCents).toBe(1099);
    expect(row!.extractedData!.taxCents).toBe(100);
    expect(row!.extractedData!.currency).toBe("AUD");
    expect(row!.extractedData!.category).toBe("supplies");
    expect(row!.extractedData!.confidence).toBeCloseTo(0.95);

    // ReceiptProcessed is the declared-but-never-published event - this is its first emitter.
    const evt = capturedEvents.find((e) => e.entityId === extractionId);
    expect(evt).toBeDefined();
    expect(evt!.type).toBe("ReceiptProcessed");
    expect(evt!.workspaceId).toBe(ws);
    expect(evt!.metadata?.status).toBe("pending");
  });

  it("applies the extraction: creates a book_transaction with receiptFileId + gstCents", async () => {
    const extractions = await svc.listExtractions(ws!, { status: "pending" });
    const extractionId = extractions[0]!.id;

    const transactionId = await svc.applyExtraction(ws!, extractionId, {}, actor);

    const txRow = await unwrapMaybe(
      getDataClient()
        .from("book_transactions")
        .select("*")
        .eq("id", transactionId)
        .limit(1)
        .maybeSingle(),
    );
    expect(txRow).not.toBeNull();
    const tx = mapBookTx(txRow!);
    expect(tx.type).toBe("expense");
    expect(tx.amountCents).toBe(1099);
    expect(tx.gstCents).toBe(100);
    expect(tx.currency).toBe("AUD");
    expect(tx.category).toBe("supplies");
    expect(tx.receiptFileId).toBe(receiptFileId);
    expect(tx.description).toBe("Mock Merchant");

    // The extraction is now `applied` with the transactionId linked back.
    const row = await svc.getExtraction(ws!, extractionId);
    expect(row!.status).toBe("applied");
    expect(row!.transactionId).toBe(transactionId);
  });

  it("is idempotent - re-applying an applied extraction throws", async () => {
    const extractions = await svc.listExtractions(ws!, { status: "applied" });
    expect(extractions.length).toBeGreaterThan(0);
    const extractionId = extractions[0]!.id;
    await expect(svc.applyExtraction(ws!, extractionId, {}, actor)).rejects.toThrow(
      /already applied/i,
    );
  });

  it("rejects an extraction without creating a transaction", async () => {
    // Extract a second receipt to reject.
    const extractionId = await svc.extractReceipt(ws!, receiptFileId!, actor);
    await svc.rejectExtraction(ws!, extractionId, actor);
    const row = await svc.getExtraction(ws!, extractionId);
    expect(row!.status).toBe("rejected");
    expect(row!.transactionId).toBeNull();
    // No new book_transaction references this extraction - only the one applied above exists.
    const txCountRows = await unwrap(
      getDataClient().from("book_transactions").select("id").eq("receipt_file_id", receiptFileId),
    );
    expect(txCountRows.length).toBe(1);
  });
});
