"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import { getDriveSettings, listVehicles, upsertDriveSettings } from "@/modules/drive";
import type { VehicleRow } from "@/modules/drive";
import { branded } from "@/shared/types/ids";

const forbid = (msg = "You don't have permission to manage drive.") => ({
  ok: false as const,
  error: msg,
});

// --- Upsert ------------------------------------------------------------------

const upsertSettingsSchema = z.object({
  mileageRateCentsPerKm: z.number().int().min(0, "Rate must not be negative."),
  defaultVehicleId: z.string().uuid().nullable().optional(),
});

export type UpsertDriveSettingsResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function upsertDriveSettingsAction(
  input: unknown,
): Promise<UpsertDriveSettingsResult> {
  const parsed = upsertSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();

  try {
    await upsertDriveSettings(
      ctx.workspaceId,
      {
        mileageRateCentsPerKm: parsed.data.mileageRateCentsPerKm,
        defaultVehicleId: parsed.data.defaultVehicleId
          ? branded<"VehicleId">(parsed.data.defaultVehicleId)
          : parsed.data.defaultVehicleId === null
            ? null
            : undefined,
      },
      ctx.user.id,
    );
    revalidatePath("/drive/settings");
    revalidatePath("/drive");
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save settings.",
    };
  }
}

// --- Loader ------------------------------------------------------------------

export type DriveSettingsPageData =
  | {
      installed: true;
      mileageRateCentsPerKm: number;
      defaultVehicleId: string | null;
      vehicles: VehicleRow[];
      canManage: boolean;
    }
  | { installed: false };

export async function loadDriveSettingsPage(): Promise<DriveSettingsPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };
  const [settings, vehicles, canManage] = await Promise.all([
    getDriveSettings(ctx.workspaceId),
    listVehicles(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);
  return {
    installed: true,
    mileageRateCentsPerKm: settings.mileageRateCentsPerKm,
    defaultVehicleId: settings.defaultVehicleId,
    vehicles,
    canManage,
  };
}
