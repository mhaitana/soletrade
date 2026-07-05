"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  type CustomerRow,
} from "@/platform/customers";
import { branded } from "@/shared/types/ids";

const forbid = (msg = "You don't have permission to manage customers.") => ({
  ok: false as const,
  error: msg,
});

const optionalString = z.string().trim().max(120).optional();
const emailField = z.string().email("Enter a valid email.").optional().or(z.literal(""));

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name is too long."),
  email: emailField,
  phone: optionalString,
  company: optionalString,
  notes: z.string().trim().max(2000).optional(),
});

export type CreateCustomerResult =
  | { ok: true; customerId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createCustomerAction(input: unknown): Promise<CreateCustomerResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:customer").ok) return forbid();

  try {
    const id = await createCustomer(ctx.workspaceId, parsed.data, ctx.user.id);
    revalidatePath("/customers");
    return { ok: true, customerId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create customer.";
    return {
      ok: false,
      error: /unique|duplicate/i.test(message)
        ? "A customer with that email already exists."
        : message,
    };
  }
}

const updateSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: emailField,
  phone: optionalString,
  company: optionalString,
  notes: z.string().trim().max(2000).optional(),
});

export type UpdateCustomerResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateCustomerAction(input: unknown): Promise<UpdateCustomerResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:customer").ok) return forbid();

  const { customerId, ...patch } = parsed.data;
  try {
    await updateCustomer(ctx.workspaceId, branded<"CustomerId">(customerId), patch, ctx.user.id);
    revalidatePath("/customers");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update customer.";
    return {
      ok: false,
      error: /unique|duplicate/i.test(message)
        ? "A customer with that email already exists."
        : message,
    };
  }
}

const deleteSchema = z.object({ customerId: z.string().uuid() });

export type DeleteCustomerResult = { ok: true } | { ok: false; error: string };

export async function deleteCustomerAction(input: unknown): Promise<DeleteCustomerResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid customer." };

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:customer").ok) return forbid();

  try {
    await deleteCustomer(
      ctx.workspaceId,
      branded<"CustomerId">(parsed.data.customerId),
      ctx.user.id,
    );
    revalidatePath("/customers");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete customer." };
  }
}

export type CustomersPageData = {
  customers: CustomerRow[];
  canManage: boolean;
};

/** Server-only data loader for the customers page. */
export async function loadCustomersPage(search?: string): Promise<CustomersPageData> {
  const ctx = await requireWorkspaceContext();
  const [customers, canManage] = await Promise.all([
    listCustomers(ctx.workspaceId, search ? { search } : undefined),
    Promise.resolve(authorize(ctx.role, "manage:customer").ok),
  ]);
  return { customers, canManage };
}

/** Single-customer loader for an edit view (workspace-isolated). */
export async function loadCustomer(
  customerId: string,
): Promise<{ customer: CustomerRow | null; canManage: boolean }> {
  const ctx = await requireWorkspaceContext();
  const [customer, canManage] = await Promise.all([
    getCustomer(ctx.workspaceId, branded<"CustomerId">(customerId)),
    Promise.resolve(authorize(ctx.role, "manage:customer").ok),
  ]);
  return { customer, canManage };
}
