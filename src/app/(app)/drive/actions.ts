"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { getWorkspace } from "@/platform/workspaces";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import {
  createEarning,
  createTrip,
  deleteEarning,
  deleteTrip,
  getDriveSummary,
  getDriveSettings,
  getEarning,
  getTrip,
  listEarnings,
  listTrips,
  updateEarning,
  updateTrip,
  type EarningInput,
  type EarningRow,
  type TripInput,
  type TripRow,
} from "@/modules/drive";
import type { DriveSummary, WeeklyDrivePoint } from "@/modules/drive/calc";
import { type Period, parsePeriod, periodRange } from "@/shared/utils/periods";
import { isDrivePlatform } from "@/shared/constants/drive-platforms";
import { branded } from "@/shared/types/ids";

const forbid = (msg = "You don't have permission to manage drive.") => ({
  ok: false as const,
  error: msg,
});

// --- Earnings actions --------------------------------------------------------

const createEarningSchema = z.object({
  platform: z.string().trim().min(1, "Pick a platform.").refine(isDrivePlatform, {
    message: "Pick a valid platform.",
  }),
  amountCents: z.number().int().min(1, "Amount must be greater than 0."),
  currency: z.string().trim().min(3).max(3).optional(),
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Description is required.").max(280),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type CreateEarningResult =
  | { ok: true; earningId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createEarningAction(input: unknown): Promise<CreateEarningResult> {
  const parsed = createEarningSchema.safeParse(input);
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
  const earningInput: EarningInput = {
    platform: d.platform,
    amountCents: d.amountCents,
    currency: d.currency,
    date: d.date,
    description: d.description,
    notes: d.notes ?? null,
  };

  try {
    const id = await createEarning(ctx.workspaceId, earningInput, ctx.user.id);
    revalidatePath("/drive");
    // The database transaction has already synchronized the Books mirror; invalidate the
    // cross-module views so soft navigation shows it immediately.
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true, earningId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to log earning." };
  }
}

const updateEarningSchema = z.object({
  earningId: z.string().uuid(),
  platform: z.string().trim().min(1).refine(isDrivePlatform, {
    message: "Pick a valid platform.",
  }),
  amountCents: z.number().int().min(1, "Amount must be greater than 0."),
  currency: z.string().trim().min(3).max(3).optional(),
  date: z.coerce.date(),
  description: z.string().trim().min(1, "Description is required.").max(280),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateEarningResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateEarningAction(input: unknown): Promise<UpdateEarningResult> {
  const parsed = updateEarningSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();

  const { earningId, ...rest } = parsed.data;
  try {
    await updateEarning(
      ctx.workspaceId,
      branded<"DriveEarningId">(earningId),
      {
        platform: rest.platform,
        amountCents: rest.amountCents,
        currency: rest.currency,
        date: rest.date,
        description: rest.description,
        notes: rest.notes ?? null,
      },
      ctx.user.id,
    );
    revalidatePath("/drive");
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update earning." };
  }
}

// --- Trips actions ------------------------------------------------------------

const createTripSchema = z.object({
  platform: z.string().trim().min(1, "Pick a platform.").refine(isDrivePlatform, {
    message: "Pick a valid platform.",
  }),
  /** User-entered km (e.g. 45.2); the action multiplies ×1000 → meters for storage. */
  distanceKm: z.coerce.number().min(0.1, "Distance must be greater than 0."),
  date: z.coerce.date(),
  purpose: z.string().trim().max(280).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type CreateTripResult =
  | { ok: true; tripId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createTripAction(input: unknown): Promise<CreateTripResult> {
  const parsed = createTripSchema.safeParse(input);
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
  const tripInput: TripInput = {
    platform: d.platform,
    distanceMeters: Math.round(d.distanceKm * 1000),
    date: d.date,
    purpose: d.purpose ? d.purpose : null,
    notes: d.notes ?? null,
  };

  try {
    const id = await createTrip(ctx.workspaceId, tripInput, ctx.user.id);
    revalidatePath("/drive");
    // The database transaction has already synchronized the Books mileage mirror.
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true, tripId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to log trip." };
  }
}

const updateTripSchema = z.object({
  tripId: z.string().uuid(),
  platform: z.string().trim().min(1).refine(isDrivePlatform, {
    message: "Pick a valid platform.",
  }),
  distanceKm: z.coerce.number().min(0.1, "Distance must be greater than 0."),
  date: z.coerce.date(),
  purpose: z.string().trim().max(280).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateTripResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateTripAction(input: unknown): Promise<UpdateTripResult> {
  const parsed = updateTripSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();

  const { tripId, ...rest } = parsed.data;
  try {
    await updateTrip(
      ctx.workspaceId,
      branded<"DriveTripId">(tripId),
      {
        platform: rest.platform,
        distanceMeters: Math.round(rest.distanceKm * 1000),
        date: rest.date,
        purpose: rest.purpose ? rest.purpose : null,
        notes: rest.notes ?? null,
      },
      ctx.user.id,
    );
    revalidatePath("/drive");
    // The database trigger reconciles the mirrored Books mileage row atomically.
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update trip." };
  }
}

// --- Delete (shared shape) ---------------------------------------------------

const earningIdSchema = z.object({ earningId: z.string().uuid() });
const tripIdSchema = z.object({ tripId: z.string().uuid() });

export type DriveActionResult = { ok: true } | { ok: false; error: string };

export async function deleteEarningAction(input: unknown): Promise<DriveActionResult> {
  const parsed = earningIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid earning." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();
  try {
    await deleteEarning(
      ctx.workspaceId,
      branded<"DriveEarningId">(parsed.data.earningId),
      ctx.user.id,
    );
    revalidatePath("/drive");
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete earning." };
  }
}

export async function deleteTripAction(input: unknown): Promise<DriveActionResult> {
  const parsed = tripIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid trip." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) return forbid();
  try {
    await deleteTrip(ctx.workspaceId, branded<"DriveTripId">(parsed.data.tripId), ctx.user.id);
    revalidatePath("/drive");
    // The database trigger removes the mirrored Books mileage row atomically.
    revalidatePath("/books");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete trip." };
  }
}

// --- Loaders (view:drive ok for any role that can view) -----------------------

export type DriveView = "earnings" | "trips";

// `periodRange` is imported from `@/shared/utils/periods` (extracted in Phase 9; the
// per-module "date math may diverge" concern never materialized - Books + Drive were identical).

export type DrivePageData =
  | {
      installed: true;
      view: DriveView;
      earnings: EarningRow[];
      trips: TripRow[];
      canManage: boolean;
      platformFilter: string | null;
      search: string;
      period: Period;
      defaultCurrency: string;
      summary: DriveSummary;
      /** Per-week earnings + distance (Wave 2) - used by the weekly sparkline. */
      weekly: WeeklyDrivePoint[];
      /** Workspace mileage rate (Wave 2) - the page surfaces it so users see the deduction basis. */
      mileageRateCentsPerKm: number;
    }
  | { installed: false };

export async function loadDrivePage(params?: {
  view?: DriveView;
  platform?: string;
  search?: string;
  period?: Period;
}): Promise<DrivePageData> {
  const ctx = await requireWorkspaceContext();
  const [enabled, workspace] = await Promise.all([
    isModuleEnabled(ctx.workspaceId, "drive"),
    getWorkspace(ctx.workspaceId),
  ]);
  if (!enabled || !workspace) return { installed: false };
  const fyStartMonth = workspace.fyStartMonth;

  const view: DriveView = params?.view === "trips" ? "trips" : "earnings";
  const period = params?.period ?? parsePeriod(undefined);
  const search = params?.search?.trim() ?? "";
  const platform = params?.platform || undefined;
  const range = periodRange(period, undefined, fyStartMonth);

  // Fetch only the visible list. The cross-entity summary is calculated in Postgres and
  // returned as compact JSON instead of transferring up to 6,000 earnings/trip/expense rows.
  const earningsPromise =
    view === "earnings"
      ? listEarnings(ctx.workspaceId, {
          platform,
          search: search || undefined,
          dateFrom: range.start ?? undefined,
          dateTo: range.end,
          limit: 100,
        })
      : Promise.resolve<EarningRow[]>([]);
  const tripsPromise =
    view === "trips"
      ? listTrips(ctx.workspaceId, {
          platform,
          search: search || undefined,
          dateFrom: range.start ?? undefined,
          dateTo: range.end,
          limit: 100,
        })
      : Promise.resolve<TripRow[]>([]);
  const [earnings, trips, settings, databaseSummary] = await Promise.all([
    earningsPromise,
    tripsPromise,
    getDriveSettings(ctx.workspaceId),
    getDriveSummary(ctx.workspaceId, {
      platform,
      dateFrom: range.start ?? undefined,
      dateTo: range.end,
      // Settings are fetched in parallel. Apply the workspace rate below using the summary's
      // aggregated distance so this call does not introduce another serial round trip.
      mileageRateCentsPerKm: 0,
    }),
  ]);

  const mileageDeductionCents = Math.round(
    (databaseSummary.totalDistanceMeters / 1000) * settings.mileageRateCentsPerKm,
  );
  const summary: DriveSummary = {
    ...databaseSummary,
    mileageDeductionCents,
    profitCents:
      databaseSummary.totalEarningsCents -
      databaseSummary.totalExpensesCents -
      mileageDeductionCents,
  };

  return {
    installed: true,
    view,
    earnings,
    trips,
    canManage: authorize(ctx.role, "manage:drive").ok,
    platformFilter: platform ?? null,
    search,
    period,
    defaultCurrency: workspace.defaultCurrency,
    summary,
    weekly: summary.weekly,
    mileageRateCentsPerKm: settings.mileageRateCentsPerKm,
  };
}

export type DriveEditData =
  | { installed: true; earning: EarningRow | null; defaultCurrency: string; canManage: boolean }
  | { installed: false };

export async function loadEarningForEdit(earningId: string): Promise<DriveEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };
  const [earning, workspace, canManage] = await Promise.all([
    getEarning(ctx.workspaceId, branded<"DriveEarningId">(earningId)),
    getWorkspace(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);
  return {
    installed: true,
    earning,
    defaultCurrency: workspace?.defaultCurrency ?? "AUD",
    canManage,
  };
}

export type DriveTripEditData =
  { installed: true; trip: TripRow | null; canManage: boolean } | { installed: false };

export async function loadTripForEdit(tripId: string): Promise<DriveTripEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) return { installed: false };
  const [trip, canManage] = await Promise.all([
    getTrip(ctx.workspaceId, branded<"DriveTripId">(tripId)),
    Promise.resolve(authorize(ctx.role, "manage:drive").ok),
  ]);
  return { installed: true, trip, canManage };
}
