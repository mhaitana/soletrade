"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import {
  createVehicle,
  deleteVehicle,
  getVehicle,
  listVehicles,
  updateVehicle,
  type VehicleInput,
  type VehiclePatch,
  type VehicleRow,
} from "@/modules/drive";
import { branded } from "@/shared/types/ids";

const forbid = (msg = "You don't have permission to manage drive.") => ({
  ok: false as const,
  error: msg,
});

// --- Create ------------------------------------------------------------------

const createVehicleSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  make: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getUTCFullYear() + 1)
    .nullable()
    .optional(),
  odometerKm: z.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

export type CreateVehicleResult =
  | { ok: true; vehicleId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createVehicleAction(input: unknown): Promise<CreateVehicleResult> {
  const parsed = createVehicleSchema.safeParse(input);
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
  const vehicleInput: VehicleInput = {
    name: d.name,
    make: d.make ?? null,
    model: d.model ?? null,
    year: d.year ?? null,
    odometerKm: d.odometerKm ?? null,
    active: d.active ?? true,
  };

  try {
    const id = await createVehicle(ctx.workspaceId, vehicleInput, ctx.user.id);
    revalidatePath("/drive/vehicles");
    return { ok: true, vehicleId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create vehicle." };
  }
}

// --- Update ------------------------------------------------------------------

const updateVehicleSchema = z.object({
  vehicleId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  make: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getUTCFullYear() + 1)
    .nullable()
    .optional(),
  odometerKm: z.number().min(0).nullable().optional(),
  active: z.boolean().optional(),
});

export type UpdateVehicleResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateVehicleAction(input: unknown): Promise<UpdateVehicleResult> {
  const parsed = updateVehicleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();

  const { vehicleId, ...rest } = parsed.data;
  const patch: VehiclePatch = {
    name: rest.name,
    make: rest.make ?? null,
    model: rest.model ?? null,
    year: rest.year ?? null,
    odometerKm: rest.odometerKm ?? null,
    active: rest.active ?? true,
  };

  try {
    await updateVehicle(ctx.workspaceId, branded<"VehicleId">(vehicleId), patch, ctx.user.id);
    revalidatePath("/drive/vehicles");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update vehicle." };
  }
}

// --- Delete ------------------------------------------------------------------

const vehicleIdSchema = z.object({ vehicleId: z.string().uuid() });

export type VehicleActionResult = { ok: true } | { ok: false; error: string };

export async function deleteVehicleAction(input: unknown): Promise<VehicleActionResult> {
  const parsed = vehicleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid vehicle." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();
  try {
    await deleteVehicle(ctx.workspaceId, branded<"VehicleId">(parsed.data.vehicleId), ctx.user.id);
    revalidatePath("/drive/vehicles");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete vehicle." };
  }
}

// --- Loaders (view:drive ok for any role that can view) ----------------------

export type VehiclesPageData =
  { installed: true; vehicles: VehicleRow[]; canManage: boolean } | { installed: false };

export async function loadVehiclesPage(): Promise<VehiclesPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };
  const [vehicles, canManage] = await Promise.all([
    listVehicles(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);
  return { installed: true, vehicles, canManage };
}

export type VehicleEditData =
  { installed: true; vehicle: VehicleRow | null; canManage: boolean } | { installed: false };

export async function loadVehicleForEdit(vehicleId: string): Promise<VehicleEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };
  const [vehicle, canManage] = await Promise.all([
    getVehicle(ctx.workspaceId, branded<"VehicleId">(vehicleId)),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);
  return { installed: true, vehicle, canManage };
}
