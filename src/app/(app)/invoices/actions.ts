"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import { listCustomers, type CustomerRow } from "@/platform/customers";
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  listInvoices,
  markInvoicePaid,
  sendInvoice,
  updateInvoice,
  voidInvoice,
  type InvoiceRow,
  type InvoiceWithItems,
  type LineItemInput,
} from "@/modules/invoices";
import type { InvoiceStatus } from "@/server/db/schema/enums";
import { branded } from "@/shared/types/ids";

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
  customerId: z.string().uuid().nullable().optional(),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  taxRate: z.number().int().min(0).max(100),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  // Form sends `notes || null`, so accept null (optional alone only allows undefined).
  notes: z.string().trim().max(2000).nullable().optional(),
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
  if (!(await authorizeOrAudit(ctx, "manage:invoice")).ok) return forbid();

  const lineItems: LineItemInput[] = parsed.data.lineItems.map((it) => ({
    description: it.description,
    quantity: it.quantity,
    unitPriceCents: it.unitPriceCents,
  }));

  try {
    const id = await createInvoice(
      ctx.workspaceId,
      {
        customerId: parsed.data.customerId ? branded<"CustomerId">(parsed.data.customerId) : null,
        issueDate: parsed.data.issueDate,
        dueDate: parsed.data.dueDate ?? null,
        currency: parsed.data.currency ?? "AUD",
        taxRate: parsed.data.taxRate,
        notes: parsed.data.notes ?? null,
        lineItems,
      },
      ctx.user.id,
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
  customerId: z.string().uuid().nullable().optional(),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date().nullable().optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  taxRate: z.number().int().min(0).max(100),
  lineItems: z.array(lineItemSchema).min(1, "Add at least one line item."),
  notes: z.string().trim().max(2000).nullable().optional(),
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
        customerId: rest.customerId ? branded<"CustomerId">(rest.customerId) : null,
        issueDate: rest.issueDate,
        dueDate: rest.dueDate ?? null,
        currency: rest.currency ?? "AUD",
        taxRate: rest.taxRate,
        notes: rest.notes ?? null,
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
    await sendInvoice(ctx.workspaceId, branded<"InvoiceId">(parsed.data.invoiceId), ctx.user.id);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
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
    await markInvoicePaid(
      ctx.workspaceId,
      branded<"InvoiceId">(parsed.data.invoiceId),
      ctx.user.id,
    );
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
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
    await voidInvoice(ctx.workspaceId, branded<"InvoiceId">(parsed.data.invoiceId), ctx.user.id);
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
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
    await deleteInvoice(ctx.workspaceId, branded<"InvoiceId">(parsed.data.invoiceId), ctx.user.id);
    revalidatePath("/invoices");
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
    }
  | { installed: false };

export async function loadInvoicesPage(params?: {
  status?: InvoiceStatus;
  search?: string;
}): Promise<InvoicesPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };

  const search = params?.search?.trim() ?? "";
  const [invoices, canManage] = await Promise.all([
    listInvoices(ctx.workspaceId, {
      status: params?.status,
      search: search || undefined,
    }),
    Promise.resolve(authorize(ctx.role, "manage:invoice").ok),
  ]);
  return {
    installed: true,
    invoices,
    canManage,
    statusFilter: params?.status ?? null,
    search,
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
      customers: CustomerRow[];
      canManage: boolean;
    }
  | { installed: false };

export async function loadInvoiceForEdit(invoiceId: string): Promise<InvoiceEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };

  const [invoice, customers, canManage] = await Promise.all([
    getInvoice(ctx.workspaceId, branded<"InvoiceId">(invoiceId)),
    listCustomers(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:invoice").ok),
  ]);
  return { installed: true, invoice, customers, canManage };
}

/** Customer list for the new-invoice form (module-gated). */
export async function loadCustomersForInvoice(): Promise<
  { installed: true; customers: CustomerRow[]; canManage: boolean } | { installed: false }
> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "invoices"))) return { installed: false };
  const [customers, canManage] = await Promise.all([
    listCustomers(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:invoice").ok),
  ]);
  return { installed: true, customers, canManage };
}
