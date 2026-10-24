import "server-only";
import { z } from "zod";
import { branded } from "@/types/ids";
import * as invoices from "@/server/domains/invoices/index";
import * as quotes from "@/server/domains/quotes/index";
import { getCustomer } from "@/server/foundation/customers/index";
import {
  convertQuoteToInvoice,
  QuoteConversionError,
} from "@/server/application/quotes/convert-quote-to-invoice";
import { MobileApiError } from "@/server/application/mobile/http";
import { paymentMethodsSchema } from "@/types/payment-methods";
import {
  checkVersion,
  conflict,
  createOnce,
  currency,
  date,
  found,
  gate,
  id,
  missing,
  notes,
  offset,
  page,
  parse,
  splitBody,
  text,
  cents,
  type Context,
  type Method,
  type Query,
} from "@/server/application/mobile/resources/common";
const item = z
  .object({
    description: text,
    quantity: z.number().positive().max(1_000_000),
    unitPriceCents: cents,
  })
  .strict();
const base = {
  customerId: z.uuid(),
  issueDate: date,
  currency,
  taxRate: z.number().int().min(0).max(100),
  pricesIncludeTax: z.boolean().optional(),
  notes,
  lineItems: z.array(item).min(1).max(500),
};
const invoiceSchema = z
  .object({
    ...base,
    dueDate: date.nullable().optional(),
    paymentMethods: paymentMethodsSchema.nullable().optional(),
  })
  .strict();
const quoteSchema = z
  .object({
    ...base,
    validUntil: date.nullable().optional(),
    sections: z
      .array(
        z
          .object({ title: text, body: z.string().max(10000), optional: z.boolean().optional() })
          .strict(),
      )
      .max(100)
      .optional(),
    termsConditions: z.string().max(50000).nullable().optional(),
  })
  .strict();
async function customerEmail(ctx: Context, customerId: string) {
  const c = await getCustomer(ctx.workspaceId, branded<"CustomerId">(customerId));
  if (!c?.email) conflict("Select a customer with an email address.");
}
export async function readSales(ctx: Context, p: string[], q: Query): Promise<unknown | Response> {
  const inv = p[0] === "invoices";
  await gate(ctx, inv ? "view:invoice" : "view:quote", inv ? "invoices" : "quotes");
  if (p.length === 1) {
    const opts = {
      search: q.search,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      customerId: q.customerId ? branded<"CustomerId">(q.customerId) : undefined,
      limit: q.limit + 1,
      offset: offset(q),
    };
    if (inv)
      return page(
        await invoices.listInvoices(ctx.workspaceId, {
          ...opts,
          status: q.status
            ? parse(z.enum(["draft", "sent", "viewed", "overdue", "paid", "void"]), q.status)
            : undefined,
        }),
        q,
      );
    return page(
      await quotes.listQuotes(ctx.workspaceId, {
        ...opts,
        status: q.status
          ? parse(
              z.enum(["draft", "sent", "viewed", "accepted", "declined", "expired", "converted"]),
              q.status,
            )
          : undefined,
      }),
      q,
    );
  }
  const entityId = id(p[1]);
  const row = found(
    inv
      ? await invoices.getInvoice(ctx.workspaceId, branded<"InvoiceId">(entityId))
      : await quotes.getQuote(ctx.workspaceId, branded<"QuoteId">(entityId)),
  );
  if (p.length === 2) return row;
  if (p.length === 3 && p[2] === "pdf")
    return (await import("@/server/application/mobile/resources/documents")).salesPdf(
      ctx,
      inv,
      row,
    );
  if (!inv && p.length === 3 && p[2] === "acceptance")
    return quotes.getAcceptance(ctx.workspaceId, branded<"QuoteId">(entityId));
  missing();
}
export async function writeSales(
  ctx: Context,
  p: string[],
  method: Method,
  body: unknown,
): Promise<unknown> {
  const inv = p[0] === "invoices";
  const creating = method === "POST" && p.length === 1;
  await gate(
    ctx,
    inv
      ? creating
        ? "create:invoice"
        : "manage:invoice"
      : creating
        ? "create:quote"
        : "manage:quote",
    inv ? "invoices" : "quotes",
  );
  const { data, expectedVersion } = splitBody(body);
  if (creating) {
    if (inv) {
      const input = parse(invoiceSchema, data);
      await customerEmail(ctx, input.customerId);
      return createOnce(
        ctx,
        (v) => invoices.getInvoice(ctx.workspaceId, branded<"InvoiceId">(v)),
        (v) =>
          invoices.createInvoice(
            ctx.workspaceId,
            { ...input, customerId: branded<"CustomerId">(input.customerId) },
            ctx.user.id,
            v ? branded<"InvoiceId">(v) : undefined,
          ),
      );
    }
    const input = parse(quoteSchema, data);
    await customerEmail(ctx, input.customerId);
    return createOnce(
      ctx,
      (v) => quotes.getQuote(ctx.workspaceId, branded<"QuoteId">(v)),
      (v) =>
        quotes.createQuote(
          ctx.workspaceId,
          { ...input, customerId: branded<"CustomerId">(input.customerId) },
          ctx.user.id,
          v ? branded<"QuoteId">(v) : undefined,
        ),
    );
  }
  const entityId = id(p[1]);
  if (inv) {
    const invoiceId = branded<"InvoiceId">(entityId);
    const row = found(await invoices.getInvoice(ctx.workspaceId, invoiceId));
    checkVersion(row, expectedVersion);
    if (p.length === 2 && method === "PATCH") {
      if (row.status !== "draft") conflict("Only draft documents can be edited.");
      const input = parse(invoiceSchema.partial(), data);
      if (input.customerId) await customerEmail(ctx, input.customerId);
      await invoices.updateInvoice(
        ctx.workspaceId,
        invoiceId,
        {
          ...input,
          customerId: input.customerId ? branded<"CustomerId">(input.customerId) : undefined,
        },
        ctx.user.id,
        expectedVersion,
      );
      return found(await invoices.getInvoice(ctx.workspaceId, invoiceId));
    }
    parse(z.object({}).strict(), data);
    let ok: boolean;
    if (p.length === 2 && method === "DELETE")
      ok = await invoices.deleteInvoice(ctx.workspaceId, invoiceId, ctx.user.id);
    else if (p.length === 3 && method === "POST") {
      switch (p[2]) {
        case "send":
          ok = await invoices.sendInvoice(ctx.workspaceId, invoiceId, ctx.user.id);
          break;
        case "paid":
        case "mark-paid":
          ok = await invoices.markInvoicePaid(ctx.workspaceId, invoiceId, ctx.user.id);
          break;
        case "void":
          ok = await invoices.voidInvoice(ctx.workspaceId, invoiceId, ctx.user.id);
          break;
        default:
          return missing();
      }
    } else return missing();
    if (!ok) conflict("This action is unavailable for the invoice's current state.");
    return method === "DELETE"
      ? { deleted: true }
      : found(await invoices.getInvoice(ctx.workspaceId, invoiceId));
  }
  const quoteId = branded<"QuoteId">(entityId);
  const row = found(await quotes.getQuote(ctx.workspaceId, quoteId));
  const converting =
    p.length === 3 && method === "POST" && ["convert", "convert-to-invoice"].includes(p[2]!);
  // Conversion retries reconcile the original invoice even after status/version changed.
  if (!converting) checkVersion(row, expectedVersion);
  if (p.length === 2 && method === "PATCH") {
    if (row.status !== "draft") conflict("Only draft documents can be edited.");
    const input = parse(quoteSchema.partial(), data);
    if (input.customerId) await customerEmail(ctx, input.customerId);
    await quotes.updateQuote(
      ctx.workspaceId,
      quoteId,
      {
        ...input,
        customerId: input.customerId ? branded<"CustomerId">(input.customerId) : undefined,
      },
      ctx.user.id,
      expectedVersion,
    );
    return found(await quotes.getQuote(ctx.workspaceId, quoteId));
  }
  parse(z.object({}).strict(), data);
  if (p.length === 2 && method === "DELETE") {
    if (!(await quotes.deleteQuote(ctx.workspaceId, quoteId, ctx.user.id)))
      conflict("Only draft quotes can be deleted.");
    return { deleted: true };
  }
  if (p.length === 3 && method === "POST" && p[2] === "send") {
    if (!(await quotes.sendQuote(ctx.workspaceId, quoteId, ctx.user.id)))
      conflict("Only draft quotes can be sent.");
    return found(await quotes.getQuote(ctx.workspaceId, quoteId));
  }
  if (converting) {
    await gate(ctx, "create:invoice", "invoices");
    if (row.status === "accepted" && row.customerId) await customerEmail(ctx, row.customerId);
    try {
      return {
        invoiceId: await convertQuoteToInvoice(ctx, quoteId, {
          invoiceId: ctx.operationId ? branded<"InvoiceId">(id(ctx.operationId)) : undefined,
          expectedUpdatedAt: expectedVersion,
        }),
      };
    } catch (error) {
      if (error instanceof QuoteConversionError)
        throw new MobileApiError(error.code, error.message, error.status);
      throw error;
    }
  }
  missing();
}
