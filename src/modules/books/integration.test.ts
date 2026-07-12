import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { getDataClient } from "@/server/db/client";
import { unwrap, unwrapMaybe, parsePgTimestamp } from "@/server/db/helpers";
import type { Database } from "@/server/db/types";
import { branded, type CustomerId, type InvoiceId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createCustomer, deleteCustomer } from "@/platform/customers";
import { enableModule } from "@/platform/module-installations";
import { clearEventBus, publishEvent } from "@/server/events";
import { createInvoice, getInvoice, markInvoicePaid, sendInvoice } from "@/modules/invoices";
import { registerBooksIntegration } from "./integration";

/**
 * Integration tests for the Books `InvoicePaid` cross-module subscriber (Phase 6c) against a
 * real Postgres. Run only when DATABASE_URL is set; skipped otherwise.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("books InvoicePaid integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000a1");
  let ws1: WorkspaceId; // Books enabled
  let ws2: WorkspaceId; // Books NOT enabled
  let ws1Customer: CustomerId;
  const createdInvoiceIds: InvoiceId[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([{ id: actor, email: "books-int@soletrade-test.local", fullName: "Books Int" }]);
    ws1 = await createWorkspace(actor, "Books Int One", `books-int-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Books Int Two", `books-int-two-${Date.now()}`);
    // Only ws1 has Books enabled - ws2 exercises the module-gate no-op.
    await enableModule(ws1, "books", actor);
    ws1Customer = await createCustomer(
      ws1,
      { name: "Soylent Corp", email: "soylent@soletrade-test.local" },
      actor,
    );
    clearEventBus();
    unsub = registerBooksIntegration();
  });

  afterAll(async () => {
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(
      workspaceIds,
      [actor],
      [
        { table: "book_transactions" },
        { table: "invoices" },
        { table: "invoice_line_items" },
        { table: "customers" },
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

  /** Count Books income rows linked to a given invoice in a workspace. */
  async function countIncomeForInvoice(
    workspaceId: WorkspaceId,
    invoiceId: InvoiceId,
  ): Promise<number> {
    const rows = await unwrap(
      getDataClient()
        .from("book_transactions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_invoice_id", invoiceId),
    );
    return rows.length;
  }

  /** Fetch the (single) Books income row linked to an invoice, or null. */
  async function getIncomeForInvoice(workspaceId: WorkspaceId, invoiceId: InvoiceId) {
    const row = await unwrapMaybe(
      getDataClient()
        .from("book_transactions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("source_invoice_id", invoiceId)
        .limit(1)
        .maybeSingle(),
    );
    return row ? mapBookTx(row) : null;
  }

  it("records Books income when an invoice is paid (happy path)", async () => {
    const lineItems = [{ description: "Consulting - 3h", quantity: 3, unitPriceCents: 12000 }];
    const invoiceId = await createInvoice(
      ws1!,
      { customerId: ws1Customer, issueDate: new Date("2026-07-01"), taxRate: 10, lineItems },
      actor,
    );
    createdInvoiceIds.push(invoiceId);
    await sendInvoice(ws1!, invoiceId, actor);
    await markInvoicePaid(ws1!, invoiceId, actor);

    const inv = await getInvoice(ws1!, invoiceId);
    expect(inv).not.toBeNull();
    const row = await getIncomeForInvoice(ws1!, invoiceId);
    expect(row).not.toBeNull();
    expect(row!.type).toBe("income");
    expect(row!.category).toBe("invoice");
    expect(row!.amountCents).toBe(inv!.totalCents);
    expect(row!.currency).toBe(inv!.currency);
    expect(row!.customerId).toBe(ws1Customer);
    expect(row!.sourceInvoiceId).toBe(invoiceId);
    expect(row!.description).toBe(`Invoice ${inv!.number}`);
    expect(row!.notes).toBe(`Auto-recorded from invoice ${inv!.number}.`);
  });

  it("is idempotent - a replayed InvoicePaid does not duplicate the income row", async () => {
    const invoiceId = createdInvoiceIds[0]!;
    const before = await countIncomeForInvoice(ws1!, invoiceId);
    expect(before).toBe(1);

    // Manually replay an InvoicePaid for the same invoice (simulates a queue redelivery).
    const inv = await getInvoice(ws1!, invoiceId);
    await publishEvent({
      type: "InvoicePaid",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "invoice",
      entityId: invoiceId,
      metadata: {
        number: inv!.number,
        totalCents: inv!.totalCents,
        currency: inv!.currency,
        publicToken: inv!.publicToken ?? "",
        dueDate: inv!.dueDate,
        customerId: ws1Customer,
        customerEmail: "soylent@soletrade-test.local",
        customerName: "Soylent Corp",
        source: "manual",
      },
    });

    const after = await countIncomeForInvoice(ws1!, invoiceId);
    expect(after).toBe(1); // unchanged
  });

  it("does not record income when Books is not installed (module gate)", async () => {
    const lineItems = [{ description: "Job", quantity: 1, unitPriceCents: 8000 }];
    const invoiceId = await createInvoice(
      ws2!,
      { issueDate: new Date("2026-07-02"), taxRate: 0, lineItems },
      actor,
    );
    createdInvoiceIds.push(invoiceId);
    await sendInvoice(ws2!, invoiceId, actor);
    await markInvoicePaid(ws2!, invoiceId, actor);

    const count = await countIncomeForInvoice(ws2!, invoiceId);
    expect(count).toBe(0);
  });

  it("records income unlinked when the invoice's customer was deleted", async () => {
    const ghostCustomer = await createCustomer(
      ws1!,
      { name: "Ghost Pty Ltd", email: "ghost@soletrade-test.local" },
      actor,
    );
    const lineItems = [{ description: "Haunted job", quantity: 1, unitPriceCents: 5000 }];
    const invoiceId = await createInvoice(
      ws1!,
      { customerId: ghostCustomer, issueDate: new Date("2026-07-03"), taxRate: 0, lineItems },
      actor,
    );
    createdInvoiceIds.push(invoiceId);
    await sendInvoice(ws1!, invoiceId, actor);
    // Soft-delete the customer after the invoice was sent but before payment.
    await deleteCustomer(ws1!, ghostCustomer, actor);
    await markInvoicePaid(ws1!, invoiceId, actor);

    const row = await getIncomeForInvoice(ws1!, invoiceId);
    expect(row).not.toBeNull();
    expect(row!.type).toBe("income");
    expect(row!.amountCents).toBe(5000);
    expect(row!.customerId).toBeNull(); // unlinked - income still recorded
    expect(row!.sourceInvoiceId).toBe(invoiceId);
  });

  it("ignores an InvoicePaid event with missing metadata (no throw, no row)", async () => {
    const before = await dbRowCountForWorkspace(ws1!);
    // Garbage metadata - no number/totalCents/currency.
    await publishEvent({
      type: "InvoicePaid",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "invoice",
      entityId: "00000000-0000-9000-8000-00000000beef",
      metadata: { junk: true },
    });
    const after = await dbRowCountForWorkspace(ws1!);
    expect(after).toBe(before); // no new row
  });
});

/** Total book_transactions row count for a workspace (used by the missing-metadata test). */
async function dbRowCountForWorkspace(workspaceId: WorkspaceId): Promise<number> {
  const rows = await unwrap(
    getDataClient().from("book_transactions").select("id").eq("workspace_id", workspaceId),
  );
  return rows.length;
}
