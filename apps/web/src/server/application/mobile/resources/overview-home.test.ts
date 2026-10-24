import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
const mocks = vi.hoisted(() => ({
  modules: vi.fn(),
  workspace: vi.fn(),
  invoice: vi.fn(),
  quote: vi.fn(),
  books: vi.fn(),
  drive: vi.fn(),
  receipts: vi.fn(),
  activity: vi.fn(),
  can: vi.fn(),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  getInstalledModules: mocks.modules,
}));
vi.mock("@/server/foundation/workspaces/index", () => ({ getWorkspace: mocks.workspace }));
vi.mock("@/lib/domain/permissions/index", () => ({ can: mocks.can }));
vi.mock("@/server/foundation/activity/index", () => ({ listActivity: mocks.activity }));
vi.mock("@/server/foundation/notifications/store", () => ({ unreadCount: async () => 0 }));
vi.mock("@/server/foundation/customers/index", () => ({ listCustomers: vi.fn() }));
vi.mock("@/server/domains/invoices/index", () => ({ getInvoiceDashboardSummary: mocks.invoice }));
vi.mock("@/server/domains/quotes/index", () => ({ getQuoteDashboardSummary: mocks.quote }));
vi.mock("@/server/domains/books/index", () => ({ getBookSummary: mocks.books }));
vi.mock("@/server/domains/drive/index", () => ({ getDriveSummary: mocks.drive }));
vi.mock("@/server/domains/books/receipt-extraction", () => ({ countExtractions: mocks.receipts }));
vi.mock("@/server/application/mobile/resources/files", () => ({ readFiles: vi.fn() }));
import { dashboard } from "@/server/application/mobile/resources/overview";
import type { Context, Query } from "@/server/application/mobile/resources/common";
const id = "11111111-1111-4111-8111-111111111111";
const ctx: Context = {
  workspaceId: branded<"WorkspaceId">(id),
  user: { id: branded<"UserId">(id), email: "owner@example.com" },
  role: "owner",
  operationId: id,
};
const query = { period: "month", limit: 20 } as Query;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(true);
  mocks.modules.mockResolvedValue(["invoices", "quotes", "books", "drive"]);
  mocks.workspace.mockResolvedValue({ id, fyStartMonth: 7, defaultCurrency: "AUD" });
  mocks.invoice.mockResolvedValue({
    paidCents: 20000,
    previousPaidCents: 10000,
    overdueCount: 2,
    overdueCents: 10000,
    draftCount: 1,
    outstandingCents: 15000,
  });
  mocks.quote.mockResolvedValue({ readyCount: 3, acceptedCount: 8, acceptedValueCents: 50000 });
  mocks.books.mockResolvedValue({ incomeCents: 30000, expenseCents: 4000, netCents: 26000 });
  mocks.drive.mockResolvedValue({ totalEarningsCents: 10000, totalExpensesCents: 2000 });
  mocks.receipts.mockResolvedValue(4);
  mocks.activity.mockResolvedValue({ items: [{ id: "activity", type: "InvoicePaid" }] });
});
describe("mobile Home overview", () => {
  it("uses canonical Books income without double-counting invoice/Drive mirrors and bounds financial KPIs", async () => {
    const result = await dashboard(ctx, query);
    expect(result.overview.totalIncome).toMatchObject({ currentCents: 30000, source: "books" });
    expect(result.overview.kpis).toHaveLength(4);
    expect(result.overview.attention.map((item) => [item.id, item.count])).toEqual([
      ["overdue-invoices", 2],
      ["accepted-quotes", 3],
      ["pending-receipts", 4],
      ["draft-invoices", 1],
    ]);
    expect(result.activity).toHaveLength(1);
    expect(result.overview.workspaceId).toBe(id);
    expect(mocks.receipts).toHaveBeenCalledWith(id, { status: "pending" });
  });
  it("combines independent paid sources without Books and never reads its receipt queue", async () => {
    mocks.modules.mockResolvedValue(["invoices", "drive"]);
    const result = await dashboard(ctx, query);
    expect(result.overview.totalIncome.currentCents).toBe(30000);
    expect(result.overview.totalIncome.source).toBe("modules");
    expect(mocks.books).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
    expect(result.overview.attention.every((item) => item.resource === "invoices")).toBe(true);
  });
  it("filters module summaries, attention and receipt counts by permission under the original workspace", async () => {
    mocks.can.mockImplementation((_: unknown, capability: string) =>
      ["view:invoice", "view:books"].includes(capability),
    );
    const result = await dashboard(ctx, query);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.drive).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(result.overview.attention.map((item) => item.resource)).toEqual([
      "invoices",
      "invoices",
    ]);
    expect(result.activity).toEqual([]);
    for (const call of [...mocks.invoice.mock.calls, ...mocks.books.mock.calls])
      expect(call[0]).toBe(id);
  });
});
