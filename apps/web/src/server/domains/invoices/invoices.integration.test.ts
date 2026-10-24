import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/testing/db-helpers";
import { branded, type CustomerId, type InvoiceId, type WorkspaceId } from "@/types/ids";
import { createWorkspace } from "@/server/foundation/workspaces";
import { createCustomer } from "@/server/foundation/customers";
import {
  createInvoice,
  deleteInvoice,
  getInvoiceDashboardSummary,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  sendInvoice,
  updateInvoice,
  voidInvoice,
} from "@/server/domains/invoices";
import { summarizeInvoices } from "@/lib/domain/invoices/calc";
import { computeInvoiceTotals } from "@/lib/domain/invoices/totals";

/**
 * Integration tests for the invoices service against a real Postgres. Run only
 * when DATABASE_URL is set; skipped otherwise (keeps `pnpm test:ci` green in
 * environments without a DB).
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("invoices integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-5000-8000-0000000000a1");
  const otherActor = branded<"UserId">("00000000-0000-5000-8000-0000000000a2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  let ws1Customer: CustomerId;
  const createdInvoiceIds: InvoiceId[] = [];

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "inv-actor@soletrade-test.local", fullName: "Inv Actor" },
      { id: otherActor, email: "inv-other@soletrade-test.local", fullName: "Inv Other" },
    ]);
    ws1 = await createWorkspace(actor, "Inv Test One", `inv-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Inv Test Two", `inv-test-two-${Date.now()}`);
    ws1Customer = await createCustomer(
      ws1,
      { name: "Acme Pty Ltd", email: "acme@soletrade-test.local" },
      actor,
    );
  });

  afterAll(async () => {
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(
      workspaceIds,
      [actor, otherActor],
      [
        { table: "invoices" },
        { table: "invoice_line_items" },
        { table: "customers" },
        { table: "audit_logs" },
      ],
    );
  });

  it("creates a draft invoice with INV-YYYY-0001 and denormalized totals", async () => {
    const lineItems = [
      { description: "Consulting - 5h", quantity: 5, unitPriceCents: 12000 },
      { description: "Expense", quantity: 1, unitPriceCents: 4500 },
    ];
    const id = await createInvoice(
      ws1!,
      { customerId: ws1Customer, issueDate: new Date("2026-01-15"), taxRate: 10, lineItems },
      actor,
    );
    createdInvoiceIds.push(id);

    const inv = await getInvoice(ws1!, id);
    expect(inv).not.toBeNull();
    const year = new Date().getFullYear();
    expect(inv!.number).toBe(`INV-${year}-0001`);
    expect(inv!.status).toBe("draft");
    expect(inv!.customerId).toBe(ws1Customer);
    expect(inv!.customerName).toBe("Acme Pty Ltd");

    const totals = computeInvoiceTotals(lineItems, 10);
    expect(inv!.subtotalCents).toBe(totals.subtotalCents);
    expect(inv!.taxCents).toBe(totals.taxCents);
    expect(inv!.totalCents).toBe(totals.totalCents);
    // Line item amounts are denormalized = round(qty × unitPrice).
    expect(inv!.lineItems[0]!.amountCents).toBe(60000);
    expect(inv!.lineItems[1]!.amountCents).toBe(4500);
    expect(inv!.publicToken).toBeNull();
    expect(inv!.sentAt).toBeNull();
  });

  it("creates a draft invoice with per-invoice payment methods", async () => {
    const paymentMethods = [
      {
        type: "bank_transfer" as const,
        accountName: "Invoice Account",
        bsb: "032-000",
        accountNumber: "987654321",
        bankName: "Westpac",
        reference: "Invoice number",
      },
    ];
    const id = await createInvoice(
      ws1!,
      {
        customerId: ws1Customer,
        issueDate: new Date("2026-03-01"),
        taxRate: 0,
        lineItems: [{ description: "Payment methods test", quantity: 1, unitPriceCents: 2000 }],
        paymentMethods,
      },
      actor,
    );
    createdInvoiceIds.push(id);

    const inv = await getInvoice(ws1!, id);
    expect(inv!.paymentMethods).toEqual(paymentMethods);
  });

  it("numbers invoices per workspace per year (ws2 starts at 0001)", async () => {
    const id = await createInvoice(
      ws2!,
      {
        issueDate: new Date("2026-02-01"),
        taxRate: 0,
        lineItems: [{ description: "Job", quantity: 1, unitPriceCents: 5000 }],
      },
      otherActor,
    );
    createdInvoiceIds.push(id);
    const inv = await getInvoice(ws2!, id);
    const year = new Date().getFullYear();
    expect(inv!.number).toBe(`INV-${year}-0001`);
  });

  it("isolates invoices per workspace (no IDOR)", async () => {
    // ws2 cannot see ws1's invoice via getInvoice…
    const ws1Inv = await getInvoice(ws1!, createdInvoiceIds[0]!);
    expect(ws1Inv).not.toBeNull();
    const cross = await getInvoice(ws2!, createdInvoiceIds[0]!);
    expect(cross).toBeNull();

    // …and listInvoices only returns the workspace's own invoices.
    const ws1List = await listInvoices(ws1!);
    const ws2List = await listInvoices(ws2!);
    expect(ws1List.some((i) => i.id === createdInvoiceIds[0])).toBe(true);
    expect(ws2List.some((i) => i.id === createdInvoiceIds[0])).toBe(false);
  });

  it("updates a draft invoice's line items and recomputes totals", async () => {
    await updateInvoice(
      ws1!,
      createdInvoiceIds[0]!,
      {
        lineItems: [{ description: "Consulting - 10h", quantity: 10, unitPriceCents: 12000 }],
        taxRate: 10,
      },
      actor,
    );
    const inv = await getInvoice(ws1!, createdInvoiceIds[0]!);
    expect(inv!.lineItems).toHaveLength(1);
    expect(inv!.lineItems[0]!.description).toBe("Consulting - 10h");
    expect(inv!.subtotalCents).toBe(120000);
    expect(inv!.taxCents).toBe(12000);
    expect(inv!.totalCents).toBe(132000);
  });

  it("updates a draft invoice's payment methods", async () => {
    const methods = [
      { type: "paypal" as const, email: "finance@acme.test" },
      { type: "payid" as const, identifier: "acme@payid.test" },
    ];
    await updateInvoice(ws1!, createdInvoiceIds[0]!, { paymentMethods: methods }, actor);
    const inv = await getInvoice(ws1!, createdInvoiceIds[0]!);
    expect(inv!.paymentMethods).toEqual(methods);
  });

  it("rejects editing a sent invoice (draft-only)", async () => {
    await sendInvoice(ws1!, createdInvoiceIds[0]!, actor);
    const sent = await getInvoice(ws1!, createdInvoiceIds[0]!);
    expect(sent!.status).toBe("sent");
    expect(sent!.publicToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sent!.sentAt).not.toBeNull();

    await expect(updateInvoice(ws1!, createdInvoiceIds[0]!, { taxRate: 0 }, actor)).rejects.toThrow(
      /draft/i,
    );
  });

  it("marks a sent invoice paid and sets paidAt", async () => {
    const ok = await markInvoicePaid(ws1!, createdInvoiceIds[0]!, actor);
    expect(ok).toBe(true);
    const inv = await getInvoice(ws1!, createdInvoiceIds[0]!);
    expect(inv!.status).toBe("paid");
    expect(inv!.paidAt).not.toBeNull();
  });

  it("markInvoicePaid is idempotent on an already-paid invoice", async () => {
    const ok = await markInvoicePaid(ws1!, createdInvoiceIds[0]!, actor);
    expect(ok).toBe(false);
  });

  it("voids a draft invoice and blocks further transitions", async () => {
    const id = await createInvoice(
      ws1!,
      {
        issueDate: new Date("2026-03-01"),
        taxRate: 0,
        lineItems: [{ description: "Draft job", quantity: 1, unitPriceCents: 1000 }],
      },
      actor,
    );
    createdInvoiceIds.push(id);

    const ok = await voidInvoice(ws1!, id, actor);
    expect(ok).toBe(true);
    const inv = await getInvoice(ws1!, id);
    expect(inv!.status).toBe("void");

    // A voided invoice can't be sent.
    const sentAfterVoid = await sendInvoice(ws1!, id, actor);
    expect(sentAfterVoid).toBe(false);
  });

  it("deletes a draft invoice (hard delete) but not a sent one", async () => {
    const draft = await createInvoice(
      ws1!,
      {
        issueDate: new Date("2026-04-01"),
        taxRate: 0,
        lineItems: [{ description: "To delete", quantity: 1, unitPriceCents: 500 }],
      },
      actor,
    );
    const ok = await deleteInvoice(ws1!, draft, actor);
    expect(ok).toBe(true);
    expect(await getInvoice(ws1!, draft)).toBeNull();

    // createdInvoiceIds[0] is paid → delete must refuse.
    const refused = await deleteInvoice(ws1!, createdInvoiceIds[0]!, actor);
    expect(refused).toBe(false);
  });

  it("rejects assigning a customer from another workspace", async () => {
    // ws1Customer belongs to ws1; creating an invoice in ws2 with that customer
    // must throw (IDOR guard on customer assignment).
    await expect(
      createInvoice(
        ws2!,
        {
          customerId: ws1Customer,
          issueDate: new Date("2026-05-01"),
          taxRate: 0,
          lineItems: [{ description: "X", quantity: 1, unitPriceCents: 100 }],
        },
        otherActor,
      ),
    ).rejects.toThrow(/not found in this workspace/i);
  });

  it("filters invoices by status and search", async () => {
    const paid = await listInvoices(ws1!, { status: "paid" });
    expect(paid.every((i) => i.status === "paid")).toBe(true);
    expect(paid.some((i) => i.id === createdInvoiceIds[0])).toBe(true);

    const byNumber = await listInvoices(ws1!, { search: "0001" });
    expect(byNumber.length).toBeGreaterThan(0);
  });

  it("returns uncapped dashboard aggregates from Postgres", async () => {
    const end = new Date("2030-01-01T00:00:00Z");
    const rows = await listInvoices(ws1!, { limit: 2000 });
    const expected = summarizeInvoices(
      rows.map((row) => ({
        status: row.status,
        totalCents: row.totalCents,
        sentAt: row.sentAt,
        paidAt: row.paidAt,
        issueDate: row.issueDate,
      })),
      { start: null, end },
    );
    const summary = await getInvoiceDashboardSummary(ws1!, { start: null, end }, null);

    expect(summary).toMatchObject(expected);
    expect(summary.overdueCents).toBe(
      rows.reduce((sum, row) => sum + (row.status === "overdue" ? row.totalCents : 0), 0),
    );
    expect(summary.previousPaidCents).toBeNull();
  });
});
