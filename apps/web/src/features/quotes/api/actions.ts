"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { createWithRequestId } from "@/server/application/request-id-create";
import { authorize } from "@/lib/domain/permissions/index";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { isModuleEnabled } from "@/server/foundation/module-installations/index";
import { getCustomer, listCustomerOptions } from "@/server/foundation/customers/index";
import type { PickerCustomer } from "@/types/customer-picker";
import {
  createQuote,
  deleteQuote,
  getAcceptance,
  getQuote,
  listQuotes,
  sendQuote,
  updateQuote,
} from "@/server/domains/quotes/index";
import type {
  QuoteAcceptanceRow,
  QuoteRow,
  QuoteWithItems,
  LineItemInput,
  SectionInput,
} from "@/lib/domain/quotes/types";
import { convertQuoteToInvoice } from "@/server/application/quotes/convert-quote-to-invoice";
import type { QuoteStatus } from "@/lib/domain/database-enums";
import { branded } from "@/types/ids";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { DOCUMENT_PAGE_SIZE, parsePage } from "@/utils/pagination";

const forbid = (msg = "You don't have permission to manage quotes.") => ({
  ok: false as const,
  error: msg,
});

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required.").max(280),
  quantity: z.number().positive("Quantity must be greater than 0."),
  unitPriceCents: z.number().int().min(0, "Unit price can't be negative."),
});

const sectionSchema = z.object({
  title: z.string().trim().min(1, "Section title is required.").max(200),
  body: z.string().max(10000),
  optional: z.boolean().optional(),
});

const createSchema = z.object({
  /** One id per form draft; resending it never creates a second record. */
  requestId: z.string().uuid().optional(),
  customerId: z.string().uuid("Pick a customer."),
  issueDate: z.coerce.date(),
  validUntil: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  taxRate: z.number().int().min(0).max(100),
  pricesIncludeTax: z.boolean().optional().default(false),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  notes: z.string().trim().max(2000).nullable().optional(),
  sections: z.array(sectionSchema).optional(),
  termsConditions: z.string().max(50000).nullable().optional(),
});

export type CreateQuoteResult =
  | { ok: true; quoteId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createQuoteAction(input: unknown): Promise<CreateQuoteResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "create:quote")).ok) return forbid();

  // Every quote must be linked to an emailable customer (no walk-in) - the email is used
  // to send the quote. The picker disables no-email customers; the server enforces too.
  const customer = await getCustomer(
    ctx.workspaceId,
    branded<"CustomerId">(parsed.data.customerId),
  );
  if (!customer || !customer.email) {
    return {
      ok: false,
      error: "Selected customer has no email - add one in Customers before sending.",
      fieldErrors: { customerId: ["This customer has no email on file."] },
    };
  }

  const lineItems: LineItemInput[] = parsed.data.lineItems.map((it) => ({
    description: it.description,
    quantity: it.quantity,
    unitPriceCents: it.unitPriceCents,
  }));

  const sections: SectionInput[] | undefined = parsed.data.sections?.map((s) => ({
    title: s.title,
    body: s.body,
    optional: s.optional,
  }));

  try {
    const { id } = await createWithRequestId(
      parsed.data.requestId ? branded<"QuoteId">(parsed.data.requestId) : undefined,
      (requestId) =>
        createQuote(
          ctx.workspaceId,
          {
            customerId: branded<"CustomerId">(parsed.data.customerId),
            issueDate: parsed.data.issueDate,
            validUntil: parsed.data.validUntil ?? null,
            currency: parsed.data.currency,
            taxRate: parsed.data.taxRate,
            pricesIncludeTax: parsed.data.pricesIncludeTax,
            notes: parsed.data.notes ?? null,
            termsConditions: parsed.data.termsConditions ?? null,
            lineItems,
            sections,
          },
          ctx.user.id,
          requestId,
        ),
      async (requestId) => (await getQuote(ctx.workspaceId, requestId)) !== null,
    );
    revalidatePath("/quotes");
    return { ok: true, quoteId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create quote.";
    return { ok: false, error: message };
  }
}

const updateSchema = z.object({
  quoteId: z.string().uuid(),
  customerId: z.string().uuid("Pick a customer."),
  issueDate: z.coerce.date(),
  validUntil: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  taxRate: z.number().int().min(0).max(100),
  pricesIncludeTax: z.boolean().optional().default(false),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  notes: z.string().trim().max(2000).nullable().optional(),
  sections: z.array(sectionSchema).optional(),
  termsConditions: z.string().max(50000).nullable().optional(),
});

export type UpdateQuoteResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateQuoteAction(input: unknown): Promise<UpdateQuoteResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:quote")).ok) return forbid();

  const { quoteId, ...rest } = parsed.data;

  // Every quote must be linked to an emailable customer (no walk-in). See createQuoteAction.
  const customer = await getCustomer(ctx.workspaceId, branded<"CustomerId">(rest.customerId));
  if (!customer || !customer.email) {
    return {
      ok: false,
      error: "Selected customer has no email - add one in Customers before sending.",
      fieldErrors: { customerId: ["This customer has no email on file."] },
    };
  }

  const lineItems: LineItemInput[] = rest.lineItems.map((it) => ({
    description: it.description,
    quantity: it.quantity,
    unitPriceCents: it.unitPriceCents,
  }));

  const sections: SectionInput[] | undefined = rest.sections?.map((s) => ({
    title: s.title,
    body: s.body,
    optional: s.optional,
  }));

  try {
    await updateQuote(
      ctx.workspaceId,
      branded<"QuoteId">(quoteId),
      {
        customerId: branded<"CustomerId">(rest.customerId),
        issueDate: rest.issueDate,
        validUntil: rest.validUntil ?? null,
        currency: rest.currency,
        taxRate: rest.taxRate,
        pricesIncludeTax: rest.pricesIncludeTax,
        notes: rest.notes ?? null,
        termsConditions: rest.termsConditions ?? null,
        lineItems,
        sections,
      },
      ctx.user.id,
    );
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update quote.";
    return { ok: false, error: message };
  }
}

const idSchema = z.object({ quoteId: z.string().uuid() });

export type QuoteActionResult = { ok: true } | { ok: false; error: string };

export async function sendQuoteAction(input: unknown): Promise<QuoteActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quote." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:quote")).ok) return forbid();
  try {
    await sendQuote(ctx.workspaceId, branded<"QuoteId">(parsed.data.quoteId), ctx.user.id);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${parsed.data.quoteId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send quote." };
  }
}

export async function deleteQuoteAction(input: unknown): Promise<QuoteActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quote." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:quote")).ok) return forbid();
  try {
    await deleteQuote(ctx.workspaceId, branded<"QuoteId">(parsed.data.quoteId), ctx.user.id);
    revalidatePath("/quotes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete quote." };
  }
}

export type ConvertQuoteResult = { ok: true; invoiceId: string } | { ok: false; error: string };

/** Convert once under the quote row lock; web and native share this operation. */
export async function convertQuoteToInvoiceAction(input: unknown): Promise<ConvertQuoteResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quote." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:quote")).ok) return forbid();

  try {
    const invoiceId = await convertQuoteToInvoice(ctx, branded<"QuoteId">(parsed.data.quoteId));

    revalidatePath("/quotes");
    revalidatePath(`/quotes/${parsed.data.quoteId}`);
    revalidatePath("/invoices");
    return { ok: true, invoiceId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to convert quote." };
  }
}

// --- Loaders (view:quote ok for any role that can view) ------------------

export type QuotesPageData =
  | {
      installed: true;
      quotes: QuoteRow[];
      canManage: boolean;
      statusFilter: QuoteStatus | null;
      search: string;
      page: number;
      hasNext: boolean;
    }
  | { installed: false };

export async function loadQuotesPage(params?: {
  status?: QuoteStatus;
  search?: string;
  page?: number;
}): Promise<QuotesPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "quotes"))) return { installed: false };

  const search = params?.search?.trim() ?? "";
  const page = parsePage(params?.page);
  const [quotes, canManage] = await Promise.all([
    listQuotes(ctx.workspaceId, {
      status: params?.status,
      search: search || undefined,
      offset: (page - 1) * DOCUMENT_PAGE_SIZE,
      limit: DOCUMENT_PAGE_SIZE + 1,
    }),
    Promise.resolve(authorize(ctx.role, "manage:quote").ok),
  ]);
  return {
    installed: true,
    quotes: quotes.slice(0, DOCUMENT_PAGE_SIZE),
    canManage,
    statusFilter: params?.status ?? null,
    search,
    page,
    hasNext: quotes.length > DOCUMENT_PAGE_SIZE,
  };
}

export type QuoteDetailData =
  | {
      installed: true;
      quote: QuoteWithItems | null;
      /** Latest acceptance row, fetched only when the quote is accepted (Wave 2). */
      acceptance: QuoteAcceptanceRow | null;
      canManage: boolean;
    }
  | { installed: false };

export async function loadQuote(quoteId: string): Promise<QuoteDetailData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "quotes"))) return { installed: false };

  const quote = await getQuote(ctx.workspaceId, branded<"QuoteId">(quoteId));
  const canManage = authorize(ctx.role, "manage:quote").ok;
  // Fetch the acceptance row only for accepted quotes (read-only - view:quote suffices;
  // the loader runs after the view:quotes gate at the page level). Saves a query otherwise.
  const acceptance =
    quote && quote.status === "accepted"
      ? await getAcceptance(ctx.workspaceId, branded<"QuoteId">(quoteId))
      : null;
  return { installed: true, quote, acceptance, canManage };
}

export type QuoteEditData =
  | {
      installed: true;
      quote: QuoteWithItems | null;
      customers: PickerCustomer[];
      defaultCurrency: string;
      canManage: boolean;
    }
  | { installed: false };

export async function loadQuoteForEdit(quoteId: string): Promise<QuoteEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "quotes"))) return { installed: false };

  const [quote, customers, workspace, canManage] = await Promise.all([
    getQuote(ctx.workspaceId, branded<"QuoteId">(quoteId)),
    listCustomerOptions(ctx.workspaceId),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:quote").ok),
  ]);
  return {
    installed: true,
    quote,
    customers,
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
  };
}

/** Customer list for the new-quote form (module-gated). */
export async function loadCustomersForQuote(): Promise<
  | { installed: true; customers: PickerCustomer[]; defaultCurrency: string; canManage: boolean }
  | { installed: false }
> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "quotes"))) return { installed: false };
  const [customers, workspace, canManage] = await Promise.all([
    listCustomerOptions(ctx.workspaceId),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "create:quote").ok),
  ]);
  return {
    installed: true,
    customers,
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
  };
}
