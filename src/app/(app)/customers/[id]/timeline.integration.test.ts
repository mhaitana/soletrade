import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupWorkspaces, seedUsers, type CleanupTable } from "@/tests/db-helpers";
import { branded, type CustomerId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createCustomer } from "@/platform/customers";
import { createInvoice } from "@/modules/invoices";
import { createQuote } from "@/modules/quotes";
import { createTransaction } from "@/modules/books";
import { writeActivity } from "@/platform/activity";

/**
 * Integration tests for `loadCustomerTimeline` against a real Postgres. The session layer
 * (`requireWorkspaceContext`) is mocked to return the test workspace + a `manager` role — what
 * we want to exercise against real rows is the merge/sort logic + IDOR via `getCustomer`, not
 * the cookie/session resolution (already covered by `context.test.ts`). The list/get functions
 * hit the real DB.
 *
 * Run only when DATABASE_URL is set; otherwise the file skips.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

// Mock ONLY the session layer — the list/get functions stay real (they hit Postgres).
const requireCtxMock = vi.fn();
vi.mock("@/platform/context", () => ({
  requireWorkspaceContext: (...a: unknown[]) => requireCtxMock(...a),
}));

describe.skipIf(!HAS_DB)("loadCustomerTimeline integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-4000-8000-000000000c01");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-000000000c02");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  let ws1Customer: CustomerId;
  let ws2Customer: CustomerId;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "tl-actor@soletrade-test.local", fullName: "TL Actor" },
      { id: otherActor, email: "tl-other@soletrade-test.local", fullName: "TL Other" },
    ]);
    ws1 = await createWorkspace(actor, "Timeline Test One", `tl-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Timeline Test Two", `tl-test-two-${Date.now()}`);

    requireCtxMock.mockResolvedValue({
      workspaceId: ws1,
      role: "manager",
      user: { id: actor, email: "tl-actor@soletrade-test.local", fullName: "TL Actor" },
    });

    ws1Customer = await createCustomer(
      ws1,
      { name: "David Bowie", email: "david@soletrade-test.local" },
      actor,
    );
    ws2Customer = await createCustomer(
      ws2,
      { name: "Freddie Mercury", email: "freddie@soletrade-test.local" },
      otherActor,
    );

    // An invoice, a quote, and a books tx for ws1Customer across three different dates.
    await createInvoice(
      ws1,
      {
        customerId: ws1Customer,
        issueDate: new Date("2026-03-10"),
        taxRate: 10,
        lineItems: [{ description: "Hero gig", quantity: 1, unitPriceCents: 12000 }],
      },
      actor,
    );
    await createQuote(
      ws1,
      {
        customerId: ws1Customer,
        issueDate: new Date("2026-02-01"),
        validUntil: new Date("2026-03-01"),
        taxRate: 10,
        lineItems: [{ description: "Design", quantity: 1, unitPriceCents: 8000 }],
      },
      actor,
    );
    await createTransaction(
      ws1,
      {
        type: "income",
        amountCents: 12000,
        date: new Date("2026-04-15"),
        description: "Bank deposit",
        category: "services",
        customerId: ws1Customer,
      },
      actor,
    );

    // A customer-lifecycle activity event for ws1Customer (written directly — the event bus
    // persister is async/timing-sensitive; this is the deterministic way to seed the row).
    await writeActivity({
      type: "CustomerCreated",
      workspaceId: ws1,
      actorUserId: actor,
      entityType: "customer",
      entityId: ws1Customer,
      metadata: { name: "David Bowie" },
    });
  });

  afterAll(async () => {
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    const tables: CleanupTable[] = [
      { table: "activity_events" },
      { table: "quote_line_items" },
      { table: "quotes" },
      { table: "invoice_line_items" },
      { table: "invoices" },
      { table: "book_transactions" },
      { table: "customers" },
      { table: "audit_logs" },
    ];
    await cleanupWorkspaces(workspaceIds, [actor, otherActor], tables);
  });

  it("returns a merged desc-sorted timeline (tx → invoice → quote) + the CustomerCreated activity", async () => {
    const { loadCustomerTimeline } = await import("./actions");
    const data = await loadCustomerTimeline(ws1Customer);
    if (!data.found) throw new Error("expected found");
    const labels = data.timeline.map((t) => `${t.kind}:${t.label}`);
    // Apr 15 tx → Mar 10 invoice → Feb 1 quote.
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^transaction:/);
    expect(labels[1]).toMatch(/^invoice:/);
    expect(labels[2]).toMatch(/^quote:/);
    // canManage true for manager.
    expect(data.canManage).toBe(true);
    // Activity panel includes the CustomerCreated event for this customer.
    const created = data.activity.find((a) => a.type === "CustomerCreated");
    expect(created).toBeDefined();
    expect(created?.entityType).toBe("customer");
    expect(created?.entityId).toBe(ws1Customer);
  });

  it("returns found:false for a customer in another workspace (IDOR)", async () => {
    const { loadCustomerTimeline } = await import("./actions");
    // Session is ws1; requesting ws2's customer → getCustomer(ws1, ws2Customer) → null.
    const data = await loadCustomerTimeline(ws2Customer);
    expect(data.found).toBe(false);
  });
});
