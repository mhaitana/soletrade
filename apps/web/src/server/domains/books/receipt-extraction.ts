import type {
  ExtractedReceiptData,
  ExtractionRow,
  ApplyExtractionPatch,
} from "@/lib/domain/books/receipt-extraction-types";
export type {
  ExtractedReceiptData,
  ExtractionRow,
  ApplyExtractionPatch,
} from "@/lib/domain/books/receipt-extraction-types";
import "server-only";
import { getBillingState } from "@/server/foundation/billing/state";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getDataClient } from "@/server/infrastructure/db/client";
import {
  parsePgTimestamp,
  rpc,
  unwrap,
  unwrapCount,
  unwrapMaybe,
  unwrapVoid,
} from "@/server/infrastructure/db/helpers";
import type { Json } from "@/lib/domain/json";
import { normalizeListOffset } from "@/utils/pagination";
import { getFile, downloadFileBytes } from "@/server/foundation/files";
import { getWorkspace } from "@/server/foundation/workspaces";
import { aiModelLabel, getAIModel, isMockProvider } from "@/server/infrastructure/ai/provider";
import { consumeCredit, reverseCreditConsumption } from "@/server/foundation/billing/credits";
import { publishEvent } from "@/server/infrastructure/events";
import { writeAudit } from "@/server/foundation/audit";
import { env } from "@/server/infrastructure/config/env";
import { isBookCategory } from "@/config/books-categories";
import {
  branded,
  type BookTransactionId,
  type FileId,
  type ReceiptExtractionId,
  type UserId,
  type WorkspaceId,
} from "@/types/ids";

/**
 * Receipt extraction pipeline (Wave 2 - Books headline feature). Uploads a receipt to
 * the vision model (Anthropic via the AI SDK; the mock provider returns canned data for
 * dev/test), stores the structured result on a `receipt_extractions` row, and publishes
 * `ReceiptProcessed` (the event is declared in the catalog + activity labels but had no
 * emitter before this). A human reviews the row in the `/books/receipts` queue and either
 * applies it (creates a `book_transactions` row) or rejects it.
 *
 * Bytes are pulled server-side from Supabase Storage (`downloadFileBytes`) and fed to the
 * model as a `FilePart` - the existing assistant route only handles text parts, so this is
 * the first image/file input path in the codebase. Credit metering is opt-in via
 * `RECEIPT_EXTRACTION_COST_CENTS` (default 0 = free); when > 0 this is the first production
 * caller of `consumeCredit`.
 */

/** Structured shape persisted on `receipt_extractions.extracted_data` (jsonb). */

/** Zod schema the model's structured output must match (`Output.object`). */
function receiptExtractionSchema(defaultCurrency: string) {
  return z.object({
    merchant: z.string(),
    date: z.string(),
    totalCents: z.number().int(),
    taxCents: z.number().int().default(0),
    currency: z.string().length(3).default(defaultCurrency),
    category: z.string(),
    lineItems: z
      .array(
        z.object({
          description: z.string(),
          quantity: z.number().default(1),
          unitPriceCents: z.number().int(),
          amountCents: z.number().int(),
        }),
      )
      .default([]),
    confidence: z.number().min(0).max(1),
  });
}

function extractionPrompt(defaultCurrency: string): string {
  return `You are a receipt extraction assistant for a small-business accounting tool.
Analyse the attached receipt image or PDF and extract its details as JSON.

- totalCents: the grand total the customer paid, in integer cents (e.g. $12.99 → 1299).
- taxCents: the GST/tax portion of the total, in integer cents (0 if none shown).
- currency: ISO 4217 3-letter code if shown, else "${defaultCurrency}".
- category: the single best-fit expense category slug from this list ONLY:
    rent, utilities, supplies, travel, wages, software_expense, vehicle_expense, other_expense
- date: the receipt date as an ISO "YYYY-MM-DD" string; if only partial/ambiguous, use the most likely date.
- lineItems: individual line items (empty array if not itemised); amountCents = round(quantity * unitPriceCents).
- confidence: your confidence in the extraction, 0.0 to 1.0 (low for blurry/ambiguous receipts).

Return ONLY the JSON object matching the schema.`;
}

/** Canned extraction for the mock provider (no API key needed - dev/test path). */
function mockExtractedData(now: Date, currency: string): ExtractedReceiptData {
  const iso = now.toISOString().slice(0, 10);
  return {
    merchant: "Mock Merchant",
    date: iso,
    totalCents: 1099,
    taxCents: 100,
    currency,
    category: "supplies",
    lineItems: [{ description: "Mock item", quantity: 1, unitPriceCents: 999, amountCents: 999 }],
    confidence: 0.95,
  };
}

const EXTRACTION_COLUMNS =
  "id, workspace_id, file_id, status, processing, extracted_data, transaction_id, error_message, model_used, created_at, updated_at";

/** Raw snake_case shape PostgREST returns for a `receipt_extractions` row. */
interface ExtractionRaw {
  id: string;
  workspace_id: string;
  file_id: string;
  status: string;
  processing: boolean;
  extracted_data: Json | null;
  transaction_id: string | null;
  error_message: string | null;
  model_used: string;
  created_at: string;
  updated_at: string;
}

function coerceExtractedData(raw: unknown): ExtractedReceiptData {
  // The schema-validated object from generateObject; the jsonb round-trip may loosen
  // types, so re-coerce defensively for callers (UI/apply).
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    merchant: String(r.merchant ?? ""),
    date: String(r.date ?? ""),
    totalCents: Math.round(Number(r.totalCents ?? 0)) || 0,
    taxCents: Math.round(Number(r.taxCents ?? 0)) || 0,
    currency: String(r.currency ?? "AUD"),
    category: String(r.category ?? "other_expense"),
    lineItems: Array.isArray(r.lineItems)
      ? (r.lineItems as Array<Record<string, unknown>>).map((li) => ({
          description: String(li.description ?? ""),
          quantity: Number(li.quantity ?? 1) || 1,
          unitPriceCents: Math.round(Number(li.unitPriceCents ?? 0)) || 0,
          amountCents: Math.round(Number(li.amountCents ?? 0)) || 0,
        }))
      : [],
    confidence: Math.min(1, Math.max(0, Number(r.confidence ?? 0))) || 0,
  };
}

/** Maps a snake_case PostgREST row to the camelCase `ExtractionRow`. */
function toExtractionRow(r: ExtractionRaw): ExtractionRow {
  return {
    id: branded<"ReceiptExtractionId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    fileId: branded<"FileId">(r.file_id),
    status: r.status as ExtractionRow["status"],
    processing: r.processing ?? false,
    extractedData: r.extracted_data ? coerceExtractedData(r.extracted_data) : null,
    transactionId: r.transaction_id ? branded<"BookTransactionId">(r.transaction_id) : null,
    errorMessage: r.error_message,
    modelUsed: r.model_used,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/**
 * Run extraction for a receipt file. Fetches the file (IDOR-safe), optionally consumes a
 * credit, downloads the bytes, calls the vision model (or the mock), persists the result,
 * and publishes `ReceiptProcessed`. Returns the new extraction id. Throws on missing file
 * or insufficient credit (caller surfaces the error).
 */
export async function extractReceipt(
  workspaceId: WorkspaceId,
  fileId: FileId,
  actorId: UserId,
  deterministicId?: ReceiptExtractionId,
): Promise<ReceiptExtractionId> {
  const supabase = getDataClient();
  // Claim before any credit or model work. An uncertain worker stays processing so a retry
  // cannot charge or invoke OCR again; operators can reconcile that visible queue row.
  if (deterministicId) {
    const existing = await getExtraction(workspaceId, deterministicId);
    if (existing) return deterministicId;
  }
  const [file, workspace] = await Promise.all([
    getFile(workspaceId, fileId),
    getWorkspace(workspaceId),
  ]);
  if (!file) throw new Error("Receipt file not found in this workspace.");
  const defaultCurrency = workspace?.defaultCurrency ?? "AUD";

  if (deterministicId) {
    const claim = await supabase.from("receipt_extractions").insert({
      id: deterministicId,
      workspace_id: workspaceId,
      file_id: fileId,
      status: "pending",
      processing: true,
      model_used: aiModelLabel("vision"),
      actor_user_id: actorId,
    });
    if (claim.error) {
      const existing = await getExtraction(workspaceId, deterministicId);
      if (existing) return deterministicId;
      throw new Error(`Receipt claim failed: ${claim.error.message}`);
    }
  }
  const billing = await getBillingState(workspaceId);
  const storeIncluded =
    (billing.provider === "apple" || billing.provider === "google") &&
    ["active", "grace", "canceled"].includes(billing.status) &&
    Boolean(billing.paidThrough && new Date(billing.paidThrough).getTime() > Date.now());
  const costCents = storeIncluded ? 0 : env.RECEIPT_EXTRACTION_COST_CENTS;
  if (costCents > 0) {
    try {
      await consumeCredit(
        workspaceId,
        {
          amountCents: costCents,
          reason: "receipt_extraction",
          moduleKey: "books",
          metadata: { fileId },
        },
        actorId,
      );
    } catch (error) {
      if (deterministicId)
        await unwrapVoid(
          supabase
            .from("receipt_extractions")
            .update({
              processing: false,
              status: "rejected",
              error_message: "Unable to pay for receipt extraction.",
              updated_at: new Date().toISOString(),
            })
            .eq("workspace_id", workspaceId)
            .eq("id", deterministicId),
        );
      throw error;
    }
  }

  // The model that actually reads the receipt (provider and id), not just the provider.
  const modelUsed = aiModelLabel("vision");
  let extracted: ExtractedReceiptData;
  let errorMessage: string | null = null;

  try {
    if (isMockProvider()) {
      extracted = mockExtractedData(new Date(), defaultCurrency);
    } else {
      const { bytes } = await downloadFileBytes(file.storagePath);
      const { output } = await generateText({
        model: getAIModel("vision"),
        output: Output.object({ schema: receiptExtractionSchema(defaultCurrency) }),
        // A receipt is a few hundred tokens of JSON; cap the call rather than leaving it at
        // the model default. On reasoning models the reasoning shares this budget.
        maxOutputTokens: 8192,
        // Ask Anthropic for native structured output. The provider's default ("auto")
        // falls back to a forced tool call for model ids it does not recognise, and
        // current Anthropic models reject forced tool calls. Ignored by other providers.
        providerOptions: { anthropic: { structuredOutputMode: "outputFormat" } },
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: bytes, mediaType: file.mimeType, filename: file.fileName },
              { type: "text", text: extractionPrompt(defaultCurrency) },
            ],
          },
        ],
      });
      extracted = coerceExtractedData(output);
    }
  } catch (err) {
    // Persist the failure as a rejected row so it's visible in the queue rather than
    // silently dropped. No extractedData; the user can still manually enter the tx.
    errorMessage = err instanceof Error ? err.message : String(err);
    extracted = coerceExtractedData({});
    // The scan was paid for before the model ran. It produced nothing, so give the credit
    // back. A failed reversal must not hide the original failure; it is logged for follow-up.
    if (costCents > 0) {
      try {
        await reverseCreditConsumption(
          workspaceId,
          {
            amountCents: costCents,
            reason: "receipt_extraction_failed",
            moduleKey: "books",
            metadata: { fileId },
          },
          actorId,
        );
      } catch (refundError) {
        console.error("[books] could not return credit for a failed receipt scan:", refundError);
      }
    }
  }

  const payload = {
    workspace_id: workspaceId,
    file_id: fileId,
    status: errorMessage ? ("rejected" as const) : ("pending" as const),
    processing: false,
    extracted_data: errorMessage ? null : (extracted as unknown as Json),
    error_message: errorMessage,
    model_used: modelUsed,
    actor_user_id: actorId,
  };
  const rows = deterministicId
    ? await unwrap(
        supabase
          .from("receipt_extractions")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("workspace_id", workspaceId)
          .eq("id", deterministicId)
          .eq("processing", true)
          .select("id"),
      )
    : await unwrap(supabase.from("receipt_extractions").insert(payload).select("id"));
  const row = rows[0];
  if (!row) throw new Error("Failed to create receipt extraction.");
  const id = branded<"ReceiptExtractionId">(row.id);

  await publishEvent({
    type: "ReceiptProcessed",
    workspaceId,
    actorUserId: actorId,
    entityType: "receipt_extraction",
    entityId: id,
    metadata: {
      fileId,
      status: errorMessage ? "rejected" : "pending",
      merchant: extracted.merchant,
      totalCents: extracted.totalCents,
      confidence: extracted.confidence,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "books.receipt.extract",
    targetType: "receipt_extraction",
    targetId: id,
    metadata: { fileId, modelUsed, status: errorMessage ? "rejected" : "pending" },
  });
  return id;
}

/** Overrides a human reviewer applies on top of the extracted data before creating a tx. */

/**
 * Apply an extraction: create a `book_transactions` row from the extracted data (with
 * reviewer overrides), set the extraction `status = 'applied'` + `transactionId`, audit.
 * Throws if the extraction isn't found, isn't pending/reviewed, or has no extractedData.
 */
export async function applyExtraction(
  workspaceId: WorkspaceId,
  extractionId: ReceiptExtractionId,
  patch: ApplyExtractionPatch,
  actorId: UserId,
): Promise<BookTransactionId> {
  const supabase = getDataClient();
  const ext = await unwrapMaybe(
    supabase
      .from("receipt_extractions")
      .select(EXTRACTION_COLUMNS)
      .eq("id", extractionId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!ext) throw new Error("Receipt extraction not found.");
  const row = ext as ExtractionRaw;
  if (row.status === "applied" && row.transaction_id)
    return branded<"BookTransactionId">(row.transaction_id);
  if (row.processing) throw new Error("Receipt extraction is still processing.");
  if (row.status !== "pending" && row.status !== "reviewed")
    throw new Error("Receipt extraction cannot be applied.");
  if (!row.extracted_data) throw new Error("Receipt extraction has no extracted data.");

  const data = coerceExtractedData(row.extracted_data);
  const type = patch.type ?? "expense";
  const amountCents = patch.amountCents ?? data.totalCents;
  const gstCents = patch.gstCents ?? data.taxCents;
  const date = patch.date ?? safeDate(data.date) ?? new Date();
  const description = patch.description?.trim() || data.merchant || "Receipt";
  const category = patch.category ?? data.category;
  if (!isBookCategory(type, category))
    throw new Error(`Unknown category "${category}" for ${type} transactions.`);

  const { data: transactionId, error } = await rpc(supabase, "mobile_apply_receipt", {
    p_workspace_id: workspaceId,
    p_extraction_id: extractionId,
    p_actor_id: actorId,
    p_transaction: {
      type,
      amount_cents: amountCents,
      gst_cents: gstCents,
      currency: patch.currency ?? data.currency,
      date: date.toISOString(),
      description,
      category,
      customer_id: patch.customerId ?? null,
      notes: patch.notes ?? null,
    },
  });
  if (error || !transactionId)
    throw new Error(error?.message ?? "Unable to apply receipt extraction.");
  return branded<"BookTransactionId">(transactionId);
}

/** Reject an extraction (discard without creating a transaction). */
export async function rejectExtraction(
  workspaceId: WorkspaceId,
  extractionId: ReceiptExtractionId,
  actorId: UserId,
): Promise<void> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("receipt_extractions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("id", extractionId)
      .eq("workspace_id", workspaceId)
      .in("status", ["pending", "reviewed", "rejected"])
      .eq("processing", false)
      .select("id"),
  );
  if (!rows[0]) throw new Error("Receipt extraction not found.");
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "books.receipt.reject",
    targetType: "receipt_extraction",
    targetId: extractionId,
    metadata: {},
  });
}

/** Count the full review queue without transferring receipt details or applying a list limit. */
export async function countExtractions(
  workspaceId: WorkspaceId,
  opts?: { status?: ExtractionRow["status"] },
): Promise<number> {
  const supabase = getDataClient();
  let query = supabase
    .from("receipt_extractions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (opts?.status) query = query.eq("status", opts.status);
  return unwrapCount(query);
}

/** List extractions for the review queue, optionally filtered by status. */
export async function listExtractions(
  workspaceId: WorkspaceId,
  opts?: {
    status?: "pending" | "reviewed" | "applied" | "rejected";
    limit?: number;
    offset?: number;
  },
): Promise<ExtractionRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 500);
  const offset = normalizeListOffset(opts?.offset);
  let query = supabase
    .from("receipt_extractions")
    .select(EXTRACTION_COLUMNS)
    .eq("workspace_id", workspaceId);
  if (opts?.status) query = query.eq("status", opts.status);
  const rows = await unwrap(
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1),
  );
  return rows.map((r) => toExtractionRow(r as ExtractionRaw));
}

/** Fetch a single extraction, workspace-scoped (IDOR-safe). */
export async function getExtraction(
  workspaceId: WorkspaceId,
  extractionId: ReceiptExtractionId,
): Promise<ExtractionRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("receipt_extractions")
      .select(EXTRACTION_COLUMNS)
      .eq("id", extractionId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toExtractionRow(row as ExtractionRaw) : null;
}

/** Parse an ISO date string defensively - returns null if invalid. */
function safeDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
