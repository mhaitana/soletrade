import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/shared/types/ids";
import type { ActivityRow } from "@/platform/activity";

/**
 * Unit tests for `loadCustomerTimeline` - the customer-360 composition root. Mocks
 * `requireWorkspaceContext` + the list/get functions; leaves `authorize` + `formatCents` real
 * (pure, no DB) so the role→canManage + money formatting paths are exercised truthfully.
 *
 * Asserts:
 *  - invoices/quotes/transactions are merged into one timeline sorted by date desc
 *  - `found: false` when `getCustomer` returns null (IDOR: customer in another workspace)
 *  - `canManage` tracks the `manage:customer` permission (manager → true, readonly → false)
 *  - activity items are passed through unchanged
 */

const requireCtxMock = vi.fn();
const getCustomerMock = vi.fn();
const listInvoicesMock = vi.fn();
const listQuotesMock = vi.fn();
const listTransactionsMock = vi.fn();
const listActivityMock = vi.fn();

vi.mock("@/platform/context", () => ({
  requireWorkspaceContext: (...a: unknown[]) => requireCtxMock(...a),
}));
vi.mock("@/platform/customers", () => ({
  getCustomer: (...a: unknown[]) => getCustomerMock(...a),
}));
vi.mock("@/modules/invoices", () => ({
  listInvoices: (...a: unknown[]) => listInvoicesMock(...a),
}));
vi.mock("@/modules/quotes", () => ({
  listQuotes: (...a: unknown[]) => listQuotesMock(...a),
}));
vi.mock("@/modules/books", () => ({
  listTransactions: (...a: unknown[]) => listTransactionsMock(...a),
}));
vi.mock("@/platform/activity", () => ({
  listActivity: (...a: unknown[]) => listActivityMock(...a),
}));

const WS = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000a0");
const CUST = branded<"CustomerId">("00000000-0000-4000-8000-0000000000a1");

function ctx(role: "manager" | "readonly") {
  return { workspaceId: WS, role, user: { id: "u1", email: "u@test", fullName: "U" } };
}

function customerRow() {
  return {
    id: CUST,
    workspaceId: WS,
    name: "Acme Corp",
    email: "billing@acme.test",
    phone: null,
    company: "Acme",
    notes: "VIP",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

function emptyActivity() {
  return { items: [] as ActivityRow[], nextCursor: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCtxMock.mockResolvedValue(ctx("manager"));
  getCustomerMock.mockResolvedValue(null);
  listInvoicesMock.mockResolvedValue([]);
  listQuotesMock.mockResolvedValue([]);
  listTransactionsMock.mockResolvedValue([]);
  listActivityMock.mockResolvedValue(emptyActivity());
});

describe("loadCustomerTimeline", () => {
  it("returns found:false (IDOR) when getCustomer is null", async () => {
    const { loadCustomerTimeline } = await import("./actions");
    const data = await loadCustomerTimeline(CUST);
    expect(data).toEqual({ found: false });
    // No fan-out happens once the customer lookup fails.
    expect(listInvoicesMock).not.toHaveBeenCalled();
    expect(listActivityMock).not.toHaveBeenCalled();
  });

  it("merges invoices + quotes + transactions into one desc-sorted timeline", async () => {
    const { loadCustomerTimeline } = await import("./actions");
    getCustomerMock.mockResolvedValue(customerRow());
    listInvoicesMock.mockResolvedValue([
      {
        id: branded<"InvoiceId">("00000000-0000-4000-8000-0000000000i1"),
        workspaceId: WS,
        customerId: CUST,
        customerName: "Acme Corp",
        number: "INV-001",
        status: "paid",
        issueDate: new Date("2026-03-10"),
        dueDate: null,
        currency: "AUD",
        taxRate: 10,
        subtotalCents: 10000,
        taxCents: 1000,
        totalCents: 11000,
        notes: null,
        publicToken: null,
        sentAt: null,
        paidAt: null,
        stripePaymentIntentId: null,
        stripeChargeId: null,
        createdAt: new Date("2026-03-10"),
        updatedAt: new Date("2026-03-10"),
      },
    ]);
    listQuotesMock.mockResolvedValue([
      {
        id: branded<"QuoteId">("00000000-0000-4000-8000-0000000000q1"),
        workspaceId: WS,
        customerId: CUST,
        customerName: "Acme Corp",
        number: "Q-001",
        status: "accepted",
        issueDate: new Date("2026-02-01"),
        expiryDate: null,
        currency: "AUD",
        taxRate: 10,
        subtotalCents: 5000,
        taxCents: 500,
        totalCents: 5500,
        notes: null,
        publicToken: null,
        sentAt: null,
        acceptedAt: null,
        declinedAt: null,
        createdAt: new Date("2026-02-01"),
        updatedAt: new Date("2026-02-01"),
      },
    ]);
    listTransactionsMock.mockResolvedValue([
      {
        id: branded<"BookTransactionId">("00000000-0000-4000-8000-0000000000b1"),
        workspaceId: WS,
        type: "income",
        amountCents: 4200,
        gstCents: 0,
        currency: "AUD",
        date: new Date("2026-04-15"),
        description: "Bank deposit",
        category: "sales",
        customerId: CUST,
        customerName: "Acme Corp",
        sourceInvoiceId: null,
        sourceEarningId: null,
        sourceExpenseId: null,
        receiptFileId: null,
        notes: null,
        createdAt: new Date("2026-04-15"),
        updatedAt: new Date("2026-04-15"),
      },
    ]);

    const data = await loadCustomerTimeline(CUST);
    if (!data.found) throw new Error("expected found");
    const labels = data.timeline.map((t) => `${t.kind}:${t.label}`);
    // Desc by date: tx (Apr 15) → invoice (Mar 10) → quote (Feb 1)
    expect(labels).toEqual(["transaction:Bank deposit", "invoice:INV-001", "quote:Q-001"]);
    // Tone mapping: paid invoice → positive; accepted quote → positive; income tx → positive.
    expect(data.timeline.map((t) => t.tone)).toEqual(["positive", "positive", "positive"]);
    // Hrefs point at the right surfaces (books tx has no detail route → /books).
    expect(data.timeline.map((t) => t.href)).toEqual([
      "/books",
      `/invoices/00000000-0000-4000-8000-0000000000i1`,
      `/quotes/00000000-0000-4000-8000-0000000000q1`,
    ]);
    // Fan-out used the {customerId} filter + limits.
    expect(listInvoicesMock).toHaveBeenCalledWith(WS, { customerId: CUST, limit: 200 });
    expect(listTransactionsMock).toHaveBeenCalledWith(WS, { customerId: CUST, limit: 500 });
  });

  it("passes activity items through and reports canManage from the role", async () => {
    const { loadCustomerTimeline } = await import("./actions");
    getCustomerMock.mockResolvedValue(customerRow());
    const activity: ActivityRow[] = [
      {
        id: branded<"ActivityEventId">("00000000-0000-4000-8000-0000000000ev1"),
        type: "CustomerCreated",
        workspaceId: WS,
        actorUserId: null,
        actorFullName: null,
        actorEmail: null,
        entityType: "customer",
        entityId: CUST,
        metadata: { name: "Acme Corp" },
        createdAt: new Date("2026-01-01"),
      },
    ];
    listActivityMock.mockResolvedValue({ items: activity, nextCursor: null });

    const data = await loadCustomerTimeline(CUST);
    if (!data.found) throw new Error("expected found");
    expect(data.canManage).toBe(true); // manager has manage:customer
    expect(data.activity).toBe(activity); // pass-through, no transform
    expect(listActivityMock).toHaveBeenCalledWith(WS, {
      entityType: "customer",
      entityId: CUST,
      limit: 100,
    });
  });

  it("reports canManage=false for a readonly member (Edit button hidden)", async () => {
    const { loadCustomerTimeline } = await import("./actions");
    requireCtxMock.mockResolvedValue(ctx("readonly"));
    getCustomerMock.mockResolvedValue(customerRow());

    const data = await loadCustomerTimeline(CUST);
    if (!data.found) throw new Error("expected found");
    expect(data.canManage).toBe(false);
  });
});
