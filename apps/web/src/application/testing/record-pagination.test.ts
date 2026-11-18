// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_PAGE_SIZE, pageHref, parsePage } from "@/utils/pagination";

/**
 * Books, Drive and Customers used to stop at 100 rows with no way to see the rest. Each
 * loader now reads one page plus one extra row, which tells the page whether "Next" exists.
 */

const mocks = vi.hoisted(() => ({
  listTransactions: vi.fn(),
  getBookSummary: vi.fn(),
  listEarnings: vi.fn(),
  listTrips: vi.fn(),
  getDriveSettings: vi.fn(),
  getDriveSummary: vi.fn(),
  listCustomers: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: vi.fn().mockResolvedValue({
    workspaceId: "00000000-0000-4000-8000-0000000000a1",
    role: "owner",
    user: { id: "00000000-0000-4000-8000-0000000000a2" },
  }),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  isModuleEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: vi.fn().mockResolvedValue({ fyStartMonth: 7, defaultCurrency: "AUD" }),
}));
vi.mock("@/server/domains/books/index", () => ({
  listTransactions: mocks.listTransactions,
  getBookSummary: mocks.getBookSummary,
}));
vi.mock("@/server/domains/drive/index", () => ({
  listEarnings: mocks.listEarnings,
  listTrips: mocks.listTrips,
  getDriveSettings: mocks.getDriveSettings,
  getDriveSummary: mocks.getDriveSummary,
}));
vi.mock("@/server/foundation/customers/index", () => ({
  listCustomers: mocks.listCustomers,
}));

import { loadBooksPage } from "@/features/books/api/actions";
import { loadDriveEntryForm, loadDrivePage } from "@/features/drive/api/actions";
import { loadCustomersPage } from "@/features/customers/api/actions";

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBookSummary.mockResolvedValue({});
  mocks.getDriveSettings.mockResolvedValue({ mileageRateCentsPerKm: 88 });
  mocks.getDriveSummary.mockResolvedValue({
    totalEarningsCents: 0,
    totalExpensesCents: 0,
    totalDistanceMeters: 0,
    weekly: [],
  });
});

describe("record list paging", () => {
  it("reads one Books page plus a look-ahead row and reports the next page", async () => {
    mocks.listTransactions.mockResolvedValue(rows(RECORD_PAGE_SIZE + 1));
    const data = await loadBooksPage({ page: 3, search: " fuel " });
    expect(mocks.listTransactions).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-0000000000a1",
      expect.objectContaining({
        search: "fuel",
        offset: 2 * RECORD_PAGE_SIZE,
        limit: RECORD_PAGE_SIZE + 1,
      }),
    );
    expect(data).toMatchObject({ installed: true, page: 3, hasNext: true });
    expect(data.installed && data.transactions).toHaveLength(RECORD_PAGE_SIZE);
  });

  it("has no next Books page when the look-ahead row is missing", async () => {
    mocks.listTransactions.mockResolvedValue(rows(RECORD_PAGE_SIZE));
    const data = await loadBooksPage();
    expect(mocks.listTransactions).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ offset: 0, limit: RECORD_PAGE_SIZE + 1 }),
    );
    expect(data).toMatchObject({ page: 1, hasNext: false });
  });

  it("pages only the Drive list that is on screen", async () => {
    mocks.listTrips.mockResolvedValue(rows(RECORD_PAGE_SIZE + 1));
    const data = await loadDrivePage({ view: "trips", page: 2 });
    expect(mocks.listEarnings).not.toHaveBeenCalled();
    expect(mocks.listTrips).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ offset: RECORD_PAGE_SIZE, limit: RECORD_PAGE_SIZE + 1 }),
    );
    expect(data).toMatchObject({ view: "trips", page: 2, hasNext: true });
    expect(data.installed && data.trips).toHaveLength(RECORD_PAGE_SIZE);
  });

  it("loads the Drive entry form without reading any list or summary", async () => {
    await expect(loadDriveEntryForm()).resolves.toEqual({
      installed: true,
      canManage: true,
      defaultCurrency: "AUD",
    });
    expect(mocks.listEarnings).not.toHaveBeenCalled();
    expect(mocks.listTrips).not.toHaveBeenCalled();
    expect(mocks.getDriveSummary).not.toHaveBeenCalled();
  });

  it("pages customers and keeps the search term", async () => {
    mocks.listCustomers.mockResolvedValue(rows(12));
    const data = await loadCustomersPage({ search: "acme", page: 2 });
    expect(mocks.listCustomers).toHaveBeenCalledWith("00000000-0000-4000-8000-0000000000a1", {
      search: "acme",
      offset: RECORD_PAGE_SIZE,
      limit: RECORD_PAGE_SIZE + 1,
    });
    expect(data).toMatchObject({ page: 2, hasNext: false });
    expect(data.customers).toHaveLength(12);
  });

  it("builds page links that keep only the filters that are set", () => {
    expect(pageHref("/drive", 2, { view: "trips", platform: null, search: "", period: "q" })).toBe(
      "/drive?view=trips&period=q&page=2",
    );
    expect(pageHref("/customers", 1, { q: "acme" })).toBe("/customers?q=acme");
    expect(parsePage("4", RECORD_PAGE_SIZE)).toBe(4);
    expect(parsePage("0", RECORD_PAGE_SIZE)).toBe(1);
  });
});
