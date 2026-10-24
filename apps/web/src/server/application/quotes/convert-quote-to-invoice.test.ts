// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";
const b = vi.hoisted(() => ({
  rpc: vi.fn(),
  enabled: vi.fn(),
  context: vi.fn(),
  quote: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: () => ({ rpc: b.rpc }) }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: b.context,
}));
vi.mock("@/server/foundation/module-installations", () => ({ isModuleEnabled: b.enabled }));
vi.mock("@/server/application/auth/authorization", () => ({
  authorizeOrAudit: async () => ({ ok: true }),
}));
vi.mock("next/cache", () => ({ revalidatePath: b.revalidate }));
vi.mock("@/server/domains/quotes", () => ({ getQuote: b.quote }));
import { convertQuoteToInvoice } from "@/server/application/quotes/convert-quote-to-invoice";
import { convertQuoteToInvoiceAction } from "@/features/quotes/api/actions";
import { writeSales } from "@/server/application/mobile/resources/sales";
const workspace = branded<"WorkspaceId">("11111111-1111-4111-8111-111111111111");
const quote = branded<"QuoteId">("22222222-2222-4222-8222-222222222222");
const invoice = "33333333-3333-4333-8333-333333333333";
const ctx = {
  workspaceId: workspace,
  user: { id: branded<"UserId">(workspace), email: "convert@test.invalid" },
  role: "owner" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  b.enabled.mockResolvedValue(true);
  b.context.mockResolvedValue(ctx);
  b.quote.mockResolvedValue({
    id: quote,
    status: "accepted",
    customerId: null,
    updatedAt: new Date("2026-10-25T01:00:00Z"),
  });
  b.rpc.mockResolvedValue({ data: { invoiceId: invoice, created: false }, error: null });
});
it("both web and native conversion call the same atomic RPC and return its original invoice", async () => {
  expect(await convertQuoteToInvoiceAction({ quoteId: quote })).toEqual({
    ok: true,
    invoiceId: invoice,
  });
  expect(
    await writeSales({ ...ctx, operationId: invoice }, ["quotes", quote, "convert"], "POST", {}),
  ).toEqual({ invoiceId: invoice });
  expect(b.rpc).toHaveBeenCalledTimes(2);
  for (const [name, args] of b.rpc.mock.calls) {
    expect(name).toBe("convert_quote_to_invoice");
    expect(args).toMatchObject({
      p_workspace_id: workspace,
      p_quote_id: quote,
      p_actor_id: workspace,
    });
  }
});
it("requires permission to manage quotes and create invoices before calling the database", async () => {
  await expect(convertQuoteToInvoice({ ...ctx, role: "employee" }, quote)).rejects.toMatchObject({
    status: 403,
  });
  expect(b.rpc).not.toHaveBeenCalled();
});
it("requires both installed modules", async () => {
  b.enabled.mockImplementation(async (_: string, key: string) => key !== "invoices");
  await expect(convertQuoteToInvoice(ctx, quote)).rejects.toMatchObject({ status: 404 });
  expect(b.rpc).not.toHaveBeenCalled();
});
it("forwards optimistic version into the locked transaction and maps stale conflicts", async () => {
  b.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "Quote changed." } });
  await expect(
    convertQuoteToInvoice(ctx, quote, { expectedUpdatedAt: "2026-10-25T01:00:00Z" }),
  ).rejects.toMatchObject({ status: 409 });
  expect(b.rpc).toHaveBeenCalledWith(
    "convert_quote_to_invoice",
    expect.objectContaining({ p_expected_updated_at: "2026-10-25T01:00:00Z" }),
  );
});
it("lets the database reconcile a completed quote despite an older accepted version", async () => {
  b.quote.mockResolvedValue({
    id: quote,
    status: "converted",
    convertedInvoiceId: invoice,
    updatedAt: new Date("2026-10-25T02:00:00Z"),
  });
  expect(
    await writeSales(ctx, ["quotes", quote, "convert"], "POST", {
      expectedVersion: "2026-10-25T01:00:00Z",
    }),
  ).toEqual({ invoiceId: invoice });
  expect(b.rpc).toHaveBeenCalledOnce();
});
