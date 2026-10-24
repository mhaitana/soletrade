import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
import type { MobileWorkspaceContext } from "@/server/application/mobile/http";

const boundary = vi.hoisted(() => ({
  modules: vi.fn(),
  customer: vi.fn(),
  customers: vi.fn(),
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  invoice: vi.fn(),
  invoices: vi.fn(),
  sendInvoice: vi.fn(),
  transaction: vi.fn(),
  transactions: vi.fn(),
  updateTransaction: vi.fn(),
  extraction: vi.fn(),
  applyExtraction: vi.fn(),
  earning: vi.fn(),
  createEarning: vi.fn(),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  getInstalledModules: boundary.modules,
  isModuleEnabled: async (_: string, key: string) => (await boundary.modules()).includes(key),
}));
vi.mock("@/server/foundation/customers/index", () => ({
  getCustomer: boundary.customer,
  listCustomers: boundary.customers,
  createCustomer: boundary.createCustomer,
  updateCustomer: boundary.updateCustomer,
}));
vi.mock("@/server/domains/invoices/index", () => ({
  getInvoice: boundary.invoice,
  listInvoices: boundary.invoices,
  sendInvoice: boundary.sendInvoice,
}));
vi.mock("@/server/domains/books/index", () => ({
  getTransaction: boundary.transaction,
  listTransactions: boundary.transactions,
  updateTransaction: boundary.updateTransaction,
}));
vi.mock("@/server/domains/books/receipt-extraction", () => ({
  getExtraction: boundary.extraction,
  applyExtraction: boundary.applyExtraction,
}));
vi.mock("@/server/domains/drive/index", () => ({
  getEarning: boundary.earning,
  createEarning: boundary.createEarning,
}));
import { readMobileResource, writeMobileResource } from "@/server/application/mobile/resources";

const id = "11111111-1111-4111-8111-111111111111";
const ctx: MobileWorkspaceContext = {
  workspaceId: branded<"WorkspaceId">(id),
  user: { id: branded<"UserId">(id), email: "owner@example.com" },
  role: "owner",
  operationId: id,
};
const customer = {
  id,
  workspaceId: id,
  name: "Alice",
  email: "alice@example.com",
  updatedAt: new Date("2026-10-25T01:00:00.000Z"),
};
beforeEach(() => {
  vi.resetAllMocks();
  boundary.modules.mockResolvedValue(["invoices", "quotes", "books", "drive"]);
  boundary.customer.mockResolvedValue(customer);
  boundary.customers.mockResolvedValue([customer]);
});
describe("mobile resource authorization and mutation boundaries", () => {
  it("rejects Books reads by an employee before reading finance data", async () => {
    await expect(
      readMobileResource(
        { ...ctx, role: "employee" },
        ["books", "transactions", id],
        new URLSearchParams(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(boundary.transaction).not.toHaveBeenCalled();
  });
  it("rejects module reads after the module is disabled", async () => {
    boundary.modules.mockResolvedValue([]);
    await expect(
      readMobileResource(ctx, ["invoices", id], new URLSearchParams()),
    ).rejects.toMatchObject({ status: 404 });
    expect(boundary.invoice).not.toHaveBeenCalled();
  });
  it("returns the existing deterministic customer after a lost create response", async () => {
    expect(await writeMobileResource(ctx, ["customers"], "POST", { name: "Alice" })).toEqual(
      customer,
    );
    expect(boundary.createCustomer).not.toHaveBeenCalled();
  });
  it("rejects a stale customer edit", async () => {
    await expect(
      writeMobileResource(ctx, ["customers", id], "PATCH", {
        name: "Edited",
        expectedVersion: "2026-10-24T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(boundary.updateCustomer).not.toHaveBeenCalled();
  });
  it("does not permit client workspace or actor fields to reach a domain update", async () => {
    await expect(
      writeMobileResource(ctx, ["customers", id], "PATCH", {
        name: "Edited",
        workspaceId: "foreign",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(boundary.updateCustomer).not.toHaveBeenCalled();
  });
  it("rejects source mirror edits before calling the Books mutation service", async () => {
    boundary.transaction.mockResolvedValue({
      id,
      updatedAt: customer.updatedAt,
      sourceInvoiceId: id,
    });
    await expect(
      writeMobileResource(ctx, ["books", "transactions", id], "PATCH", { amountCents: 500 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(boundary.updateTransaction).not.toHaveBeenCalled();
  });
  it("treats invalid lifecycle transitions as conflicts", async () => {
    boundary.invoice.mockResolvedValue({ id, updatedAt: customer.updatedAt, status: "paid" });
    boundary.sendInvoice.mockResolvedValue(false);
    await expect(
      writeMobileResource(ctx, ["invoices", id, "send"], "POST", {}),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("bounds pagination and rejects invalid dates", async () => {
    await expect(
      readMobileResource(ctx, ["customers"], new URLSearchParams({ limit: "1000000" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readMobileResource(
        ctx,
        ["drive", "earnings"],
        new URLSearchParams({ dateFrom: "yesterday" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("returns typed not-found for unknown resource paths", async () => {
    await expect(readMobileResource(ctx, ["bogus"], new URLSearchParams())).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects edits to a sent invoice with a lifecycle conflict", async () => {
    boundary.invoice.mockResolvedValue({ id, status: "sent", updatedAt: customer.updatedAt });
    await expect(
      writeMobileResource(ctx, ["invoices", id], "PATCH", { notes: "Edited" }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("validates transaction categories at the native boundary", async () => {
    await expect(
      writeMobileResource(ctx, ["books", "transactions"], "POST", {
        type: "expense",
        amountCents: 1000,
        date: "2026-10-25T00:00:00Z",
        description: "Fuel",
        category: "invented",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("validates Drive platform slugs at the native boundary", async () => {
    await expect(
      writeMobileResource(ctx, ["drive", "earnings"], "POST", {
        platform: "invented",
        amountCents: 1000,
        date: "2026-10-25T00:00:00Z",
        description: "Gig",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("forwards Books category filters before domain pagination", async () => {
    boundary.transactions.mockResolvedValue([{ id, category: "supplies" }]);
    expect(
      await readMobileResource(
        ctx,
        ["books", "transactions"],
        new URLSearchParams({ category: "supplies", limit: "1" }),
      ),
    ).toMatchObject({ items: [{ id, category: "supplies" }] });
    expect(boundary.transactions).toHaveBeenCalledWith(
      ctx.workspaceId,
      expect.objectContaining({ category: "supplies", offset: 0, limit: 2 }),
    );
  });
  it("does not allow receipt application while OCR is processing", async () => {
    boundary.extraction.mockResolvedValue({
      id,
      status: "pending",
      processing: true,
      updatedAt: customer.updatedAt,
    });
    await expect(
      writeMobileResource(ctx, ["books", "receipts", id, "apply"], "POST", {}),
    ).rejects.toMatchObject({ status: 409 });
    expect(boundary.applyExtraction).not.toHaveBeenCalled();
  });

  it("forwards the accepted edit version and translates a concurrent database conflict", async () => {
    const expectedVersion = customer.updatedAt.toISOString();
    boundary.updateCustomer.mockRejectedValue(
      new Error("PostgREST error [40001]: Record changed."),
    );
    await expect(
      writeMobileResource(ctx, ["customers", id], "PATCH", { name: "Edited", expectedVersion }),
    ).rejects.toMatchObject({ status: 409 });
    expect(boundary.updateCustomer).toHaveBeenCalledWith(
      ctx.workspaceId,
      id,
      { name: "Edited" },
      ctx.user.id,
      expectedVersion,
    );
  });
});
