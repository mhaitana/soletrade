import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/shared/types/ids";

/**
 * Unit tests for the global search composition root (`searchWorkspace`). The list functions +
 * `getInstalledModules` are mocked so we can assert:
 *  - canonical group order (customers first) + empty groups dropped
 *  - module gating (only installed modules produce groups)
 *  - the `< 2` char guard returns `[]`
 *  - per-row tagging (label/sublabel/href) is correct
 *
 * The pure formatters (`formatCents`/`formatBytes`/`formatDate`) are left real — they have no
 * DB dependency. Only the DB-hitting list functions + module registry are mocked.
 */

const listCustomersMock = vi.fn();
const listFilesMock = vi.fn();
const listInvoicesMock = vi.fn();
const listQuotesMock = vi.fn();
const listTransactionsMock = vi.fn();
const listEarningsMock = vi.fn();
const listTripsMock = vi.fn();
const listExpensesMock = vi.fn();
const getInstalledModulesMock = vi.fn();

vi.mock("@/platform/module-installations", () => ({
  getInstalledModules: (...a: unknown[]) => getInstalledModulesMock(...a),
}));
vi.mock("@/platform/customers", () => ({
  listCustomers: (...a: unknown[]) => listCustomersMock(...a),
}));
vi.mock("@/platform/files", () => ({
  listFiles: (...a: unknown[]) => listFilesMock(...a),
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
vi.mock("@/modules/drive", () => ({
  listEarnings: (...a: unknown[]) => listEarningsMock(...a),
  listTrips: (...a: unknown[]) => listTripsMock(...a),
  listExpenses: (...a: unknown[]) => listExpensesMock(...a),
}));

const WS = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000a0");

beforeEach(() => {
  vi.clearAllMocks();
  // Default: nothing installed (so only customers + files run). Per-test overrides.
  getInstalledModulesMock.mockResolvedValue([]);
  listCustomersMock.mockResolvedValue([]);
  listFilesMock.mockResolvedValue({ items: [], nextCursor: null });
  listInvoicesMock.mockResolvedValue([]);
  listQuotesMock.mockResolvedValue([]);
  listTransactionsMock.mockResolvedValue([]);
  listEarningsMock.mockResolvedValue([]);
  listTripsMock.mockResolvedValue([]);
  listExpensesMock.mockResolvedValue([]);
});

describe("searchWorkspace", () => {
  it("returns [] for queries shorter than 2 chars (no 1-char seq scans)", async () => {
    const { searchWorkspace } = await import("./search");
    expect(await searchWorkspace(WS, "a")).toEqual([]);
    expect(await searchWorkspace(WS, " ")).toEqual([]);
    expect(await searchWorkspace(WS, "")).toEqual([]);
    // Nothing fetched — the guard short-circuits before any list call.
    expect(listCustomersMock).not.toHaveBeenCalled();
    expect(getInstalledModulesMock).not.toHaveBeenCalled();
  });

  it("returns groups in canonical order (customers first) and drops empty groups", async () => {
    const { searchWorkspace } = await import("./search");
    listCustomersMock.mockResolvedValue([
      {
        id: branded<"CustomerId">("00000000-0000-4000-8000-0000000000a1"),
        workspaceId: WS,
        name: "Acme Corp",
        email: "billing@acme.test",
        phone: null,
        company: "Acme",
        notes: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    // No invoices/quotes/etc → those groups are dropped. Files empty → files dropped.
    // Only the customers group should survive.
    const groups = await searchWorkspace(WS, "acme");
    expect(groups.map((g) => g.module)).toEqual(["customers"]);
    expect(groups[0]!.results[0]).toMatchObject({
      module: "customers",
      label: "Acme Corp",
      sublabel: "billing@acme.test · Acme",
      href: `/customers/00000000-0000-4000-8000-0000000000a1`,
    });
  });

  it("gates module groups by getInstalledModules (books-only workspace)", async () => {
    const { searchWorkspace } = await import("./search");
    getInstalledModulesMock.mockResolvedValue(["books"]);
    listTransactionsMock.mockResolvedValue([
      {
        id: branded<"BookTransactionId">("00000000-0000-4000-8000-0000000000b1"),
        workspaceId: WS,
        type: "income",
        amountCents: 12000,
        gstCents: 0,
        currency: "AUD",
        date: new Date("2026-02-03"),
        description: "Office supplies sale",
        category: "sales",
        customerId: null,
        customerName: null,
        sourceInvoiceId: null,
        sourceEarningId: null,
        sourceExpenseId: null,
        receiptFileId: null,
        notes: null,
        createdAt: new Date("2026-02-03"),
        updatedAt: new Date("2026-02-03"),
      },
    ]);
    const groups = await searchWorkspace(WS, "office");
    // customers (empty, dropped), books (present), files (empty, dropped). No invoice/quote/drive
    // groups — their list functions were never called because the modules aren't installed.
    expect(groups.map((g) => g.module)).toEqual(["books"]);
    expect(listInvoicesMock).not.toHaveBeenCalled();
    expect(listQuotesMock).not.toHaveBeenCalled();
    expect(listEarningsMock).not.toHaveBeenCalled();
    expect(listTransactionsMock).toHaveBeenCalledOnce();
    expect(groups[0]!.results[0]).toMatchObject({
      module: "books",
      label: "Office supplies sale",
      // income → "+" prefix; formatCents(12000, "AUD") = "$120.00"
      sublabel: "+$120.00",
      href: "/books",
    });
  });

  it("fans out to all three drive list functions when drive is installed and merges into one group", async () => {
    const { searchWorkspace } = await import("./search");
    getInstalledModulesMock.mockResolvedValue(["drive"]);
    listEarningsMock.mockResolvedValue([
      {
        id: branded<"DriveEarningId">("00000000-0000-4000-8000-0000000000e1"),
        workspaceId: WS,
        platform: "uber",
        amountCents: 5500,
        currency: "AUD",
        date: new Date("2026-03-01"),
        description: "Uber earnings",
        notes: null,
        createdAt: new Date("2026-03-01"),
        updatedAt: new Date("2026-03-01"),
      },
    ]);
    listTripsMock.mockResolvedValue([
      {
        id: branded<"DriveTripId">("00000000-0000-4000-8000-0000000000t1"),
        workspaceId: WS,
        platform: "uber",
        distanceMeters: 18500,
        date: new Date("2026-03-02"),
        purpose: "Airport run",
        notes: null,
        createdAt: new Date("2026-03-02"),
        updatedAt: new Date("2026-03-02"),
      },
    ]);
    listExpensesMock.mockResolvedValue([]);
    const groups = await searchWorkspace(WS, "uber");
    expect(groups.map((g) => g.module)).toEqual(["drive"]);
    const drive = groups[0]!.results;
    expect(drive).toHaveLength(2);
    expect(drive[0]!.label).toBe("Uber earnings");
    expect(drive[1]!.label).toBe("Airport run");
  });

  it("passes the trimmed query + limitPerModule to each list function", async () => {
    const { searchWorkspace } = await import("./search");
    getInstalledModulesMock.mockResolvedValue(["invoices"]);
    listInvoicesMock.mockResolvedValue([
      {
        id: branded<"InvoiceId">("00000000-0000-4000-8000-0000000000i1"),
        workspaceId: WS,
        customerId: null,
        customerName: "Acme",
        number: "INV-2026-0001",
        status: "sent",
        issueDate: new Date("2026-04-01"),
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
        createdAt: new Date("2026-04-01"),
        updatedAt: new Date("2026-04-01"),
      },
    ]);
    await searchWorkspace(WS, "  inv  ", { limitPerModule: 4 });
    expect(listInvoicesMock).toHaveBeenCalledWith(WS, { search: "inv", limit: 4 });
    expect(listCustomersMock).toHaveBeenCalledWith(WS, { search: "inv", limit: 4 });
    // Files always runs (platform surface, not module-gated).
    expect(listFilesMock).toHaveBeenCalledWith(WS, { search: "inv", limit: 4 });
  });
});
