import "server-only";
import { z } from "zod";
import type { WorkspaceContext } from "@/lib/domain/auth/workspace-context-types";
import { can } from "@/lib/domain/permissions";
import { isModuleEnabled } from "@/server/foundation/module-installations";
import { getDataClient } from "@/server/infrastructure/db/client";
import { rpc } from "@/server/infrastructure/db/helpers";
import { branded, type InvoiceId, type QuoteId } from "@/types/ids";

export class QuoteConversionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "QuoteConversionError";
  }
}
const resultSchema = z.object({ invoiceId: z.uuid(), created: z.boolean() });

/** Shared web/native composition boundary; the database owns all financial writes/history. */
export async function convertQuoteToInvoice(
  ctx: WorkspaceContext,
  quoteId: QuoteId,
  options: { invoiceId?: InvoiceId; expectedUpdatedAt?: string } = {},
): Promise<InvoiceId> {
  if (!can(ctx.role, "manage:quote") || !can(ctx.role, "create:invoice"))
    throw new QuoteConversionError("forbidden", "Your role cannot convert quotes.", 403);
  const modules = await Promise.all([
    isModuleEnabled(ctx.workspaceId, "quotes"),
    isModuleEnabled(ctx.workspaceId, "invoices"),
  ]);
  if (modules.some((enabled) => !enabled))
    throw new QuoteConversionError(
      "module_unavailable",
      "Quotes and Invoices must both be enabled.",
      404,
    );
  z.uuid().parse(quoteId);
  if (options.invoiceId) z.uuid().parse(options.invoiceId);
  if (options.expectedUpdatedAt) z.iso.datetime({ offset: true }).parse(options.expectedUpdatedAt);
  const { data, error } = await rpc(getDataClient(), "convert_quote_to_invoice", {
    p_workspace_id: ctx.workspaceId,
    p_quote_id: quoteId,
    p_actor_id: ctx.user.id,
    p_invoice_id: options.invoiceId ?? null,
    p_expected_updated_at: options.expectedUpdatedAt ?? null,
    // Match ordinary createInvoice's local calendar year and workspace prefix format.
    p_number_year: new Date().getFullYear(),
  });
  if (error) {
    if (error.code === "42501") throw new QuoteConversionError("forbidden", error.message, 403);
    if (error.code === "P0002") throw new QuoteConversionError("not_found", error.message, 404);
    if (["40001", "55000", "23505"].includes(error.code))
      throw new QuoteConversionError("conflict", error.message, 409);
    throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  }
  return branded<"InvoiceId">(resultSchema.parse(data).invoiceId);
}
