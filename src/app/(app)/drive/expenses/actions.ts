"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  listVehicles,
  updateExpense,
  type ExpenseInput,
  type ExpensePatch,
  type ExpenseRow,
  type VehicleRow,
} from "@/modules/drive";
import type { VehicleExpenseType } from "@/server/db/enums";
import { branded } from "@/shared/types/ids";
import { getWorkspace } from "@/platform/workspaces";

const forbid = (msg = "You don't have permission to manage drive.") => ({
  ok: false as const,
  error: msg,
});

const VEHICLE_EXPENSE_TYPES: readonly VehicleExpenseType[] = [
  "fuel",
  "maintenance",
  "insurance",
  "registration",
  "other",
];

// --- Create ------------------------------------------------------------------

const createExpenseSchema = z.object({
  vehicleId: z.string().uuid("Pick a vehicle."),
  type: z.enum(VEHICLE_EXPENSE_TYPES as [VehicleExpenseType, ...VehicleExpenseType[]]),
  amountCents: z.number().int().min(1, "Amount must be greater than 0."),
  currency: z.string().trim().min(3).max(3).optional(),
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Description is required.").max(280),
  odometerKm: z.number().min(0).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  receiptFileId: z.string().uuid().nullable().optional(),
});

export type CreateExpenseResult =
  | { ok: true; expenseId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createExpenseAction(input: unknown): Promise<CreateExpenseResult> {
  const parsed = createExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();

  const d = parsed.data;
  const expenseInput: ExpenseInput = {
    vehicleId: branded<"VehicleId">(d.vehicleId),
    type: d.type,
    amountCents: d.amountCents,
    currency: d.currency,
    date: d.date,
    description: d.description,
    odometerKm: d.odometerKm ?? null,
    notes: d.notes ?? null,
    receiptFileId: d.receiptFileId ? branded<"FileId">(d.receiptFileId) : null,
  };

  try {
    const id = await createExpense(ctx.workspaceId, expenseInput, ctx.user.id);
    revalidatePath("/drive/expenses");
    // The database transaction has already synchronized the Books mirror; invalidate the
    // cross-module views so soft navigation shows it immediately.
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true, expenseId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to log expense." };
  }
}

// --- Update ------------------------------------------------------------------

const updateExpenseSchema = z.object({
  expenseId: z.string().uuid(),
  type: z.enum(VEHICLE_EXPENSE_TYPES as [VehicleExpenseType, ...VehicleExpenseType[]]),
  amountCents: z.number().int().min(1, "Amount must be greater than 0."),
  currency: z.string().trim().min(3).max(3).optional(),
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Description is required.").max(280),
  odometerKm: z.number().min(0).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  receiptFileId: z.string().uuid().nullable().optional(),
});

export type UpdateExpenseResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateExpenseAction(input: unknown): Promise<UpdateExpenseResult> {
  const parsed = updateExpenseSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();

  const { expenseId, ...rest } = parsed.data;
  const patch: ExpensePatch = {
    type: rest.type,
    amountCents: rest.amountCents,
    currency: rest.currency,
    date: rest.date,
    description: rest.description,
    odometerKm: rest.odometerKm ?? null,
    notes: rest.notes ?? null,
    receiptFileId: rest.receiptFileId ? branded<"FileId">(rest.receiptFileId) : null,
  };

  try {
    await updateExpense(ctx.workspaceId, branded<"DriveExpenseId">(expenseId), patch, ctx.user.id);
    revalidatePath("/drive/expenses");
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update expense." };
  }
}

// --- Delete ------------------------------------------------------------------

const expenseIdSchema = z.object({ expenseId: z.string().uuid() });

export type ExpenseActionResult = { ok: true } | { ok: false; error: string };

export async function deleteExpenseAction(input: unknown): Promise<ExpenseActionResult> {
  const parsed = expenseIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid expense." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();
  try {
    await deleteExpense(
      ctx.workspaceId,
      branded<"DriveExpenseId">(parsed.data.expenseId),
      ctx.user.id,
    );
    revalidatePath("/drive/expenses");
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete expense." };
  }
}

// --- Loaders (view:drive ok for any role that can view) ----------------------

export interface ExpenseWithVehicle {
  expense: ExpenseRow;
  vehicle: VehicleRow | null;
}

export type ExpensesPageData =
  | {
      installed: true;
      expenses: ExpenseWithVehicle[];
      vehicles: VehicleRow[];
      defaultCurrency: string;
      canManage: boolean;
      vehicleFilter: string | null;
    }
  | { installed: false };

export async function loadExpensesPage(params?: { vehicleId?: string }): Promise<ExpensesPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };

  const vehicleId = params?.vehicleId;
  const [vehicles, expenses, workspace, canManage] = await Promise.all([
    listVehicles(ctx.workspaceId),
    listExpenses(ctx.workspaceId, {
      vehicleId: vehicleId ? branded<"VehicleId">(vehicleId) : undefined,
      limit: 200,
    }),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v] as const));
  const expensesWithVehicle: ExpenseWithVehicle[] = expenses.map((expense) => ({
    expense,
    vehicle: vehicleMap.get(expense.vehicleId) ?? null,
  }));

  return {
    installed: true,
    expenses: expensesWithVehicle,
    vehicles,
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
    vehicleFilter: vehicleId ?? null,
  };
}

export type ExpenseEditData =
  | {
      installed: true;
      expense: ExpenseRow | null;
      vehicles: VehicleRow[];
      defaultCurrency: string;
      canManage: boolean;
    }
  | { installed: false };

export async function loadExpenseForEdit(expenseId: string): Promise<ExpenseEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };
  const [expense, vehicles, workspace, canManage] = await Promise.all([
    getExpense(ctx.workspaceId, branded<"DriveExpenseId">(expenseId)),
    listVehicles(ctx.workspaceId),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);
  return {
    installed: true,
    expense,
    vehicles,
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
  };
}
