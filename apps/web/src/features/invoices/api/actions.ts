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
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  sendInvoice,
  updateInvoice,
  voidInvoice,
} from "@/server/domains/invoices/index";
import type { InvoiceRow, InvoiceWithItems, LineItemInput } from "@/lib/domain/invoices/types";
import type { InvoiceStatus } from "@/lib/domain/database-enums";
import { branded } from "@/types/ids";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { DOCUMENT_PAGE_SIZE, parsePage } from "@/utils/pagination";
import {
  parsePaymentMethods,
  paymentMethodsSchema,
  type PaymentMethods,
} from "@/types/payment-methods";

const forbid = (msg = "You don't have permission to manage invoices.") => ({
  ok: false as const,
  error: msg,
});

const lineItemSchema = z.object({
  description: z.string().trim().min(1, "Description is required.").max(280),
  quantity: z.number().positive("Quantity must be greater than 0."),
  unitPriceCents: z.number().int().min(0, "Unit price can't be negative."),
});

const createSchema = z.object({
  /** One id per form draft; resending it never creates a second record. */
  requestId: z.string().uuid().optional(),
  customerId: z.string().uuid("Pick a customer."),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  taxRate: z.number().int().min(0).max(100),
  pricesIncludeTax: z.boolean().optional().default(false),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  // Form sends `notes || null`, so accept null (optional alone only allows undefined).
  notes: z.string().trim().max(2000).nullable().optional(),
  paymentMethods: paymentMethodsSchema.nullable().optional(),
});

export type CreateInvoiceResult =
  | { ok: true; invoiceId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createInvoiceAction(input: unknown): Promise<CreateInvoiceResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "create:invoice")).ok) return forbid();

  // Every invoice must be linked to an emailable customer (no walk-in) - the email is
  // used to send the invoice. The picker disables no-email customers, but the server
  // enforces it too (defense-in-depth + covers API/convert paths).
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

  try {
    const { id } = await createWithRequestId(
      parsed.data.requestId ? branded<"InvoiceId">(parsed.data.requestId) : undefined,
      (requestId) =>
        createInvoice(
          ctx.workspaceId,
          {
            customerId: branded<"CustomerId">(parsed.data.customerId),
            issueDate: parsed.data.issueDate,
            dueDate: parsed.data.dueDate ?? null,
            currency: parsed.data.currency,
            taxRate: parsed.data.taxRate,
            pricesIncludeTax: parsed.data.pricesIncludeTax,
            notes: parsed.data.notes ?? null,
            paymentMethods: parsed.data.paymentMethods ?? null,
            lineItems,
          },
          ctx.user.id,
          requestId,
        ),
      async (requestId) => (await getInvoice(ctx.workspaceId, requestId)) !== null,
    );
    revalidatePath("/invoices");
    return { ok: true, invoiceId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create invoice.";
    return { ok: false, error: message };
  }
}

const updateSchema = z.object({
  invoiceId: z.string().uuid(),
  customerId: z.string().uuid("Pick a customer."),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  taxRate: z.number().int().min(0).max(100),
  pricesIncludeTax: z.boolean().optional().default(false),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  notes: z.string().trim().max(2000).nullable().optional(),
  paymentMethods: paymentMethodsSchema.nullable().optional(),
});

export type UpdateInvoiceResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateInvoiceAction(input: unknown): Promise<UpdateInvoiceResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) return forbid();

  const { invoiceId, ...rest } = parsed.data;

  // Every invoice must be linked to an emailable customer (no walk-in). See createInvoiceAction.
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

  try {
    await updateInvoice(
      ctx.workspaceId,
      branded<"InvoiceId">(invoiceId),
      {
        customerId: branded<"CustomerId">(rest.customerId),
        issueDate: rest.issueDate,
        dueDate: rest.dueDate ?? null,
        currency: rest.currency,
        taxRate: rest.taxRate,
        pricesIncludeTax: rest.pricesIncludeTax,
        notes: rest.notes ?? null,
        paymentMethods: rest.paymentMethods ?? null,
        lineItems,
      },
      ctx.user.id,
    );
    revalidatePath("/invoices");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update invoice.";
    return { ok: false, error: message };
  }
}

const idSchema = z.object({ invoiceId: z.string().uuid() });

export type InvoiceActionResult = { ok: true } | { ok: false; error: string };

export async function sendInvoiceAction(input: unknown): Promise<InvoiceActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invoice." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) return forbid();
  try {
    const sent = await sendInvoice(
      ctx.workspaceId,
      branded<"InvoiceId">(parsed.data.invoiceId),
      ctx.user.id,
    );
    if (!sent) return { ok: false, error: "Only a draft invoice can be sent." };
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send invoice." };
  }
}

export async function markInvoicePaidAction(input: unknown): Promise<InvoiceActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invoice." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) return forbid();
  try {
    const paid = await markInvoicePaid(
      ctx.workspaceId,
      branded<"InvoiceId">(parsed.data.invoiceId),
      ctx.user.id,
    );
    if (!paid) {
      return { ok: false, error: "Only an outstanding invoice can be marked paid." };
    }
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark invoice paid.",
    };
  }
}

export async function voidInvoiceAction(input: unknown): Promise<InvoiceActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invoice." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) return forbid();
  try {
    const voided = await voidInvoice(
      ctx.workspaceId,
      branded<"InvoiceId">(parsed.data.invoiceId),
      ctx.user.id,
    );
    if (!voided) return { ok: false, error: "Only an unpaid invoice can be voided." };
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to void invoice." };
  }
}

export async function deleteInvoiceAction(input: unknown): Promise<InvoiceActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid invoice." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) return forbid();
  try {
    const deleted = await deleteInvoice(
      ctx.workspaceId,
      branded<"InvoiceId">(parsed.data.invoiceId),
      ctx.user.id,
    );
    if (!deleted) return { ok: false, error: "Only a draft invoice can be deleted." };
    revalidatePath("/invoices");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete invoice." };
  }
}

// --- Loaders (view:invoice ok for any role that can view) ------------------

export type InvoicesPageData =
  | {
      installed: true;
      invoices: InvoiceRow[];
      canManage: boolean;
      statusFilter: InvoiceStatus | null;
      search: string;
      page: number;
      hasNext: boolean;
    }
  | { installed: false };

export async function loadInvoicesPage(params?: {
  status?: InvoiceStatus;
  search?: string;
  page?: number;
}): Promise<InvoicesPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };

  const search = params?.search?.trim() ?? "";
  const page = parsePage(params?.page);
  const [invoices, canManage] = await Promise.all([
    listInvoices(ctx.workspaceId, {
      status: params?.status,
      search: search || undefined,
      offset: (page - 1) * DOCUMENT_PAGE_SIZE,
      limit: DOCUMENT_PAGE_SIZE + 1,
    }),
    Promise.resolve(authorize(ctx.role, "manage:invoice").ok),
  ]);
  return {
    installed: true,
    invoices: invoices.slice(0, DOCUMENT_PAGE_SIZE),
    canManage,
    statusFilter: params?.status ?? null,
    search,
    page,
    hasNext: invoices.length > DOCUMENT_PAGE_SIZE,
  };
}

export type InvoiceDetailData =
  { installed: true; invoice: InvoiceWithItems | null; canManage: boolean } | { installed: false };

export async function loadInvoice(invoiceId: string): Promise<InvoiceDetailData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };

  const [invoice, canManage] = await Promise.all([
    getInvoice(ctx.workspaceId, branded<"InvoiceId">(invoiceId)),
    Promise.resolve(authorize(ctx.role, "manage:invoice").ok),
  ]);
  return { installed: true, invoice, canManage };
}

export type InvoiceEditData =
  | {
      installed: true;
      invoice: InvoiceWithItems | null;
      customers: PickerCustomer[];
      workspacePaymentMethods: PaymentMethods;
      defaultCurrency: string;
      canManage: boolean;
    }
  | { installed: false };

export async function loadInvoiceForEdit(invoiceId: string): Promise<InvoiceEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };

  const [invoice, customers, workspace, canManage] = await Promise.all([
    getInvoice(ctx.workspaceId, branded<"InvoiceId">(invoiceId)),
    listCustomerOptions(ctx.workspaceId),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:invoice").ok),
  ]);
  const paymentMethods = parsePaymentMethods(workspace?.paymentMethods ?? null);
  return {
    installed: true,
    invoice,
    customers,
    workspacePaymentMethods: paymentMethods.ok ? paymentMethods.methods : [],
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
  };
}

/** Customer list for the new-invoice form (module-gated). */
export async function loadCustomersForInvoice(): Promise<
  | {
      installed: true;
      customers: PickerCustomer[];
      workspacePaymentMethods: PaymentMethods;
      defaultCurrency: string;
      canManage: boolean;
    }
  | { installed: false }
> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };
  const [customers, workspace, canManage] = await Promise.all([
    listCustomerOptions(ctx.workspaceId),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "create:invoice").ok),
  ]);
  const paymentMethods = parsePaymentMethods(workspace?.paymentMethods ?? null);
  return {
    installed: true,
    customers,
    workspacePaymentMethods: paymentMethods.ok ? paymentMethods.methods : [],
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
  };
}
