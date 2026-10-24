import type {
  EarningInput,
  EarningPatch,
  EarningRow,
  TripInput,
  TripPatch,
  TripRow,
  VehicleInput,
  VehiclePatch,
  VehicleRow,
  ExpenseInput,
  ExpensePatch,
  ExpenseRow,
  DriveSettingsRow,
} from "@/lib/domain/drive/types";
export type {
  EarningInput,
  EarningPatch,
  EarningRow,
  TripInput,
  TripPatch,
  TripRow,
  VehicleInput,
  VehiclePatch,
  VehicleRow,
  ExpenseInput,
  ExpensePatch,
  ExpenseRow,
  DriveSettingsRow,
} from "@/lib/domain/drive/types";
import "server-only";
import { z } from "zod";
import { getDataClient } from "@/server/infrastructure/db/client";
import {
  parsePgTimestamp,
  pgQuote,
  rpc,
  unwrap,
  unwrapMaybe,
  unwrapVoid,
} from "@/server/infrastructure/db/helpers";
import { publishEvent } from "@/server/infrastructure/events";
import { writeAudit } from "@/server/foundation/audit";
import { getWorkspace } from "@/server/foundation/workspaces";
import { isDrivePlatform } from "@/config/drive-platforms";
import type { VehicleExpenseType } from "@/lib/domain/database-enums";
import type { DriveSummary as DriveSummaryResult } from "@/lib/domain/drive/calc";
import {
  branded,
  type DriveEarningId,
  type DriveExpenseId,
  type DriveTripId,
  type FileId,
  type UserId,
  type VehicleId,
  type WorkspaceId,
} from "@/types/ids";

/**
 * Drive module service (Phase 7). Workspace-scoped CRUD for gig-economy earnings + mileage
 * trips. All queries filter `.eq("workspace_id", workspaceId)` - never trust a client
 * workspace id; the caller resolves it from the session (`requireWorkspaceContext`).
 *
 * Two independent entity types:
 * - **Earnings** - a dated money entry (platform, amount, currency, description, notes).
 * - **Trips**    - a dated distance entry (platform, distance in meters, purpose, notes).
 *
 * No lifecycle / status - a row is a dated ledger entry. Money is integer cents; distance is
 * integer meters (smallest unit, mirrors the cents pattern). Platforms are slugs from the pure
 * `drive-platforms` catalog, validated here as a defensive guard (the action already
 * validates). Delete is hard-delete + audit-logged; soft-delete is a later phase.
 *
 * Events fire on **every mutation**: creates publish `DriveEarningsLogged` /
 * `VehicleExpenseLogged` / `MileageLogged` (the meaningful "logged" moment for the activity
 * feed), and edits/deletes publish `*Updated` / `*Deleted` so the Books mirror stays in sync
 * (the `@/modules/books/integration` subscribers reconcile the mirrored row - "Drive wins",
 * unconditional overwrite). `MileageLogged` carries the computed deduction amount
 * (distance × workspace mileage rate) so the Books expense row is created at log time. All
 * mutations write audit (`drive.earning.*` / `drive.trip.*`); the action layer does not audit
 * (mirrors Books).
 *
 * `actorId` is **required** for every mutation - earnings/trips are always user-logged, so
 * there is no system-actor path (unlike Books' optional `actorId` for the InvoicePaid
 * subscriber). The audit log + event carry `actorUserId: actorId`.
 */

// ────────────────────────────── Earnings ──────────────────────────────

const EARNING_COLUMNS =
  "id, workspace_id, platform, amount_cents, currency, date, description, notes, created_at, updated_at";

interface EarningRaw {
  id: string;
  workspace_id: string;
  platform: string;
  amount_cents: number;
  currency: string;
  date: string;
  description: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toEarningRow(r: EarningRaw): EarningRow {
  return {
    id: branded<"DriveEarningId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    platform: r.platform,
    amountCents: r.amount_cents,
    currency: r.currency,
    date: parsePgTimestamp(r.date),
    description: r.description,
    notes: r.notes,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

// ─────────────────────────────── Trips ───────────────────────────────

const TRIP_COLUMNS =
  "id, workspace_id, platform, vehicle_id, distance_meters, date, purpose, notes, created_at, updated_at";

interface TripRaw {
  id: string;
  workspace_id: string;
  platform: string;
  vehicle_id?: string | null;
  distance_meters: number;
  date: string;
  purpose: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function toTripRow(r: TripRaw): TripRow {
  return {
    id: branded<"DriveTripId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    platform: r.platform,
    vehicleId: r.vehicle_id ? branded<"VehicleId">(r.vehicle_id) : null,
    distanceMeters: r.distance_meters,
    date: parsePgTimestamp(r.date),
    purpose: r.purpose,
    notes: r.notes,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

// ────────────────────────────── helpers ──────────────────────────────

/** Verify a platform slug is in the catalog. Throws if not. */
function assertPlatform(platform: string): void {
  if (!isDrivePlatform(platform)) {
    throw new Error(`Unknown platform "${platform}".`);
  }
}

/**
 * Mileage deduction in integer cents for a distance (ATO cents-per-km): `round(km * rate)`.
 * 0 when the rate is unset/zero. Mirrors the calc in `./calc.ts` so the per-trip Books row
 * matches the Drive page's summary-time deduction.
 */
function mileageAmountCents(distanceMeters: number, rateCentsPerKm: number): number {
  return rateCentsPerKm > 0 ? Math.round((distanceMeters / 1000) * rateCentsPerKm) : 0;
}

// ─────────────────────────── Earnings CRUD ─────────────────────────────

/** Create an earning. Validates the platform + publishes `DriveEarningsLogged` + audits. */
export async function createEarning(
  workspaceId: WorkspaceId,
  input: EarningInput,
  actorId: UserId,
  deterministicId?: DriveEarningId,
): Promise<DriveEarningId> {
  if (input.amountCents <= 0) throw new Error("Amount must be greater than 0.");
  assertPlatform(input.platform);

  const workspace = await getWorkspace(workspaceId);
  const currency = input.currency ?? workspace?.defaultCurrency ?? "AUD";
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("drive_earnings")
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        platform: input.platform,
        amount_cents: input.amountCents,
        currency,
        date: input.date.toISOString(),
        description: input.description.trim(),
        notes: input.notes ?? null,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create earning.");
  const id = branded<"DriveEarningId">(row.id);

  await publishEvent({
    type: "DriveEarningsLogged",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_earning",
    entityId: id,
    metadata: {
      platform: input.platform,
      amountCents: input.amountCents,
      currency,
      date: input.date,
      description: input.description.trim(),
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.earning.create",
    targetType: "drive_earning",
    targetId: id,
    metadata: { platform: input.platform, amountCents: input.amountCents },
  });
  return id;
}

/** Update an earning (workspace-isolated). Throws if not found. No event (silent edit). */
export async function updateEarning(
  workspaceId: WorkspaceId,
  earningId: DriveEarningId,
  patch: EarningPatch,
  actorId: UserId,
  expectedUpdatedAt?: string,
): Promise<void> {
  if (patch.platform !== undefined) assertPlatform(patch.platform);
  if (patch.amountCents !== undefined && patch.amountCents <= 0) {
    throw new Error("Amount must be greater than 0.");
  }

  const supabase = getDataClient();
  // Explicit column-keyed shape (not a loose Record<string, unknown>) - the generated
  // `.update()` type rejects an `unknown` index signature.
  const set: {
    updated_at: string;
    mobile_expected_updated_at?: string;
    platform?: string;
    amount_cents?: number;
    currency?: string;
    date?: string;
    description?: string;
    notes?: string | null;
  } = {
    updated_at: new Date().toISOString(),
    ...(expectedUpdatedAt !== undefined ? { mobile_expected_updated_at: expectedUpdatedAt } : {}),
  };
  if (patch.platform !== undefined) set.platform = patch.platform;
  if (patch.amountCents !== undefined) set.amount_cents = patch.amountCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.date !== undefined) set.date = patch.date.toISOString();
  if (patch.description !== undefined) set.description = patch.description.trim();
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;

  const rows = await unwrap(
    supabase
      .from("drive_earnings")
      .update(set)
      .eq("id", earningId)
      .eq("workspace_id", workspaceId)
      .select("id, platform, amount_cents, currency, date, description"),
  );
  const row = rows[0];
  if (!row) throw new Error("Earning not found.");

  await publishEvent({
    type: "DriveEarningUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_earning",
    entityId: branded<"DriveEarningId">(row.id),
    metadata: {
      earningId: row.id,
      platform: row.platform,
      amountCents: row.amount_cents,
      currency: row.currency,
      date: parsePgTimestamp(row.date),
      description: row.description,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.earning.update",
    targetType: "drive_earning",
    targetId: earningId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** Hard-delete an earning (workspace-isolated). Returns false if not found in this workspace. */
export async function deleteEarning(
  workspaceId: WorkspaceId,
  earningId: DriveEarningId,
  actorId: UserId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("drive_earnings")
      .delete()
      .eq("id", earningId)
      .eq("workspace_id", workspaceId)
      .select("id, platform, amount_cents"),
  );
  const row = rows[0];
  if (!row) return false;

  await publishEvent({
    type: "DriveEarningDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_earning",
    entityId: branded<"DriveEarningId">(row.id),
    metadata: { earningId: row.id },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.earning.delete",
    targetType: "drive_earning",
    targetId: earningId,
    metadata: { platform: row.platform, amountCents: row.amount_cents },
  });
  return true;
}

/** List earnings for a workspace, optionally filtered by platform/search/date range. */
export async function listEarnings(
  workspaceId: WorkspaceId,
  opts?: {
    platform?: string;
    search?: string;
    /** Inclusive lower bound on `date`. */
    dateFrom?: Date;
    /** Inclusive upper bound on `date`. */
    dateTo?: Date;
    offset?: number;
    limit?: number;
  },
): Promise<EarningRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 2000);
  let query = supabase
    .from("drive_earnings")
    .select(EARNING_COLUMNS)
    .eq("workspace_id", workspaceId);
  if (opts?.platform) query = query.eq("platform", opts.platform);
  if (opts?.dateFrom) query = query.gte("date", opts.dateFrom.toISOString());
  if (opts?.dateTo) query = query.lte("date", opts.dateTo.toISOString());
  const search = opts?.search?.trim();
  if (search) {
    const term = pgQuote(`%${search}%`);
    query = query.or(`description.ilike.${term},notes.ilike.${term}`);
  }
  const rows = await unwrap(
    query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(Math.max(0, opts?.offset ?? 0), Math.max(0, opts?.offset ?? 0) + limit - 1),
  );
  return rows.map((r) => toEarningRow(r as EarningRaw));
}

/**
 * Fetch a single earning, scoped to the workspace. IDOR-safe - returns null when the earning
 * belongs to another workspace.
 */
export async function getEarning(
  workspaceId: WorkspaceId,
  earningId: DriveEarningId,
): Promise<EarningRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("drive_earnings")
      .select(EARNING_COLUMNS)
      .eq("id", earningId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toEarningRow(row as EarningRaw) : null;
}

// ───────────────────────────── Trips CRUD ──────────────────────────────

/** Create a trip. Validates the platform + publishes `MileageLogged` + audits. */
export async function createTrip(
  workspaceId: WorkspaceId,
  input: TripInput,
  actorId: UserId,
  deterministicId?: DriveTripId,
): Promise<DriveTripId> {
  if (input.distanceMeters <= 0) throw new Error("Distance must be greater than 0.");
  assertPlatform(input.platform);
  if (input.vehicleId && !(await getVehicle(workspaceId, input.vehicleId)))
    throw new Error("Vehicle not found in this workspace.");

  const [settings, workspace] = await Promise.all([
    getDriveSettings(workspaceId),
    getWorkspace(workspaceId),
  ]);
  const amountCents = mileageAmountCents(input.distanceMeters, settings.mileageRateCentsPerKm);

  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("drive_trips")
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        platform: input.platform,
        vehicle_id: input.vehicleId ?? null,
        distance_meters: input.distanceMeters,
        date: input.date.toISOString(),
        purpose: input.purpose ?? null,
        notes: input.notes ?? null,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create trip.");
  const id = branded<"DriveTripId">(row.id);

  await publishEvent({
    type: "MileageLogged",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_trip",
    entityId: id,
    metadata: {
      tripId: id,
      platform: input.platform,
      distanceMeters: input.distanceMeters,
      date: input.date,
      amountCents,
      currency: workspace?.defaultCurrency ?? "AUD",
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.trip.create",
    targetType: "drive_trip",
    targetId: id,
    metadata: { platform: input.platform, distanceMeters: input.distanceMeters },
  });
  return id;
}

/** Update a trip (workspace-isolated). Throws if not found. No event (silent edit). */
export async function updateTrip(
  workspaceId: WorkspaceId,
  tripId: DriveTripId,
  patch: TripPatch,
  actorId: UserId,
  expectedUpdatedAt?: string,
): Promise<void> {
  if (patch.platform !== undefined) assertPlatform(patch.platform);
  if (patch.distanceMeters !== undefined && patch.distanceMeters <= 0) {
    throw new Error("Distance must be greater than 0.");
  }

  if (patch.vehicleId && !(await getVehicle(workspaceId, patch.vehicleId)))
    throw new Error("Vehicle not found in this workspace.");
  const supabase = getDataClient();
  const set: {
    updated_at: string;
    mobile_expected_updated_at?: string;
    platform?: string;
    vehicle_id?: VehicleId | null;
    distance_meters?: number;
    date?: string;
    purpose?: string | null;
    notes?: string | null;
  } = {
    updated_at: new Date().toISOString(),
    ...(expectedUpdatedAt !== undefined ? { mobile_expected_updated_at: expectedUpdatedAt } : {}),
  };
  if (patch.platform !== undefined) set.platform = patch.platform;
  if (patch.vehicleId !== undefined) set.vehicle_id = patch.vehicleId;
  if (patch.distanceMeters !== undefined) set.distance_meters = patch.distanceMeters;
  if (patch.date !== undefined) set.date = patch.date.toISOString();
  if (patch.purpose !== undefined) set.purpose = patch.purpose ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;

  const rows = await unwrap(
    supabase
      .from("drive_trips")
      .update(set)
      .eq("id", tripId)
      .eq("workspace_id", workspaceId)
      .select("id, platform, distance_meters, date"),
  );
  const row = rows[0];
  if (!row) throw new Error("Trip not found.");

  // Recompute the deduction with the current workspace mileage rate so the Books mirror
  // stays in step with the Drive page's summary-time calc.
  const [settings, workspace] = await Promise.all([
    getDriveSettings(workspaceId),
    getWorkspace(workspaceId),
  ]);
  const amountCents = mileageAmountCents(row.distance_meters, settings.mileageRateCentsPerKm);
  await publishEvent({
    type: "MileageUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_trip",
    entityId: branded<"DriveTripId">(row.id),
    metadata: {
      tripId: row.id,
      platform: row.platform,
      distanceMeters: row.distance_meters,
      date: parsePgTimestamp(row.date),
      amountCents,
      currency: workspace?.defaultCurrency ?? "AUD",
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.trip.update",
    targetType: "drive_trip",
    targetId: tripId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** Hard-delete a trip (workspace-isolated). Returns false if not found in this workspace. */
export async function deleteTrip(
  workspaceId: WorkspaceId,
  tripId: DriveTripId,
  actorId: UserId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("drive_trips")
      .delete()
      .eq("id", tripId)
      .eq("workspace_id", workspaceId)
      .select("id, platform, distance_meters"),
  );
  const row = rows[0];
  if (!row) return false;

  await publishEvent({
    type: "MileageDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_trip",
    entityId: branded<"DriveTripId">(row.id),
    metadata: { tripId: row.id },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.trip.delete",
    targetType: "drive_trip",
    targetId: tripId,
    metadata: { platform: row.platform, distanceMeters: row.distance_meters },
  });
  return true;
}

/** List trips for a workspace, optionally filtered by platform/search/date range. */
export async function listTrips(
  workspaceId: WorkspaceId,
  opts?: {
    platform?: string;
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    offset?: number;
    limit?: number;
  },
): Promise<TripRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 2000);
  let query = supabase.from("drive_trips").select(TRIP_COLUMNS).eq("workspace_id", workspaceId);
  if (opts?.platform) query = query.eq("platform", opts.platform);
  if (opts?.dateFrom) query = query.gte("date", opts.dateFrom.toISOString());
  if (opts?.dateTo) query = query.lte("date", opts.dateTo.toISOString());
  const search = opts?.search?.trim();
  if (search) {
    const term = pgQuote(`%${search}%`);
    query = query.or(`purpose.ilike.${term},notes.ilike.${term}`);
  }
  const rows = await unwrap(
    query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(Math.max(0, opts?.offset ?? 0), Math.max(0, opts?.offset ?? 0) + limit - 1),
  );
  return rows.map((r) => toTripRow(r as TripRaw));
}

/**
 * Fetch a single trip, scoped to the workspace. IDOR-safe - returns null when the trip
 * belongs to another workspace.
 */
export async function getTrip(
  workspaceId: WorkspaceId,
  tripId: DriveTripId,
): Promise<TripRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("drive_trips")
      .select(TRIP_COLUMNS)
      .eq("id", tripId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toTripRow(row as TripRaw) : null;
}

const driveSummarySchema = z.object({
  totalEarningsCents: z.number(),
  totalDistanceMeters: z.number(),
  earningsCount: z.number(),
  tripsCount: z.number(),
  byPlatform: z.array(
    z.object({
      platform: z.string(),
      earningsCents: z.number(),
      distanceMeters: z.number(),
      earningsCount: z.number(),
      tripsCount: z.number(),
    }),
  ),
  monthly: z.array(
    z.object({
      month: z.string(),
      earningsCents: z.number(),
      distanceMeters: z.number(),
    }),
  ),
  weekly: z.array(
    z.object({
      week: z.string(),
      earningsCents: z.number(),
      distanceMeters: z.number(),
    }),
  ),
  mileageDeductionCents: z.number(),
  totalExpensesCents: z.number(),
  profitCents: z.number(),
});

/** Aggregate Drive earnings, trips, and expenses in Postgres without transferring raw rows. */
export async function getDriveSummary(
  workspaceId: WorkspaceId,
  opts?: {
    platform?: string;
    dateFrom?: Date;
    dateTo?: Date;
    mileageRateCentsPerKm?: number;
  },
): Promise<DriveSummaryResult> {
  const { data, error } = await rpc(getDataClient(), "get_drive_summary", {
    p_workspace_id: workspaceId,
    p_platform: opts?.platform ?? null,
    p_date_from: opts?.dateFrom?.toISOString() ?? null,
    p_date_to: opts?.dateTo?.toISOString() ?? null,
    p_mileage_rate_cents_per_km: opts?.mileageRateCentsPerKm ?? 0,
  });
  if (error) throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  return driveSummarySchema.parse(data);
}

// Re-export the pure aggregator (Phase 9 cross-module dashboard loader uses it).
export {
  summarizeDrive,
  type DriveSummary,
  type EarningSummaryInput,
  type TripSummaryInput,
  type MonthlyDrivePoint,
  type WeeklyDrivePoint,
  type VehicleExpenseSummaryInput,
  formatKm,
} from "@/lib/domain/drive/calc";

// ───────────────────────────── Vehicles (Wave 2) ─────────────────────────────

const VEHICLE_COLUMNS =
  "id, workspace_id, name, make, model, year, odometer_km, active, created_at, updated_at";

interface VehicleRaw {
  id: string;
  workspace_id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometer_km: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function toVehicleRow(r: VehicleRaw): VehicleRow {
  return {
    id: branded<"VehicleId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    name: r.name,
    make: r.make,
    model: r.model,
    year: r.year,
    odometerKm: r.odometer_km,
    active: r.active,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/** Create a vehicle. */
export async function createVehicle(
  workspaceId: WorkspaceId,
  input: VehicleInput,
  actorId: UserId,
  deterministicId?: VehicleId,
): Promise<VehicleId> {
  if (!input.name.trim()) throw new Error("Vehicle name is required.");
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("vehicles")
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        name: input.name.trim(),
        make: input.make ?? null,
        model: input.model ?? null,
        year: input.year ?? null,
        odometer_km: input.odometerKm ?? null,
        active: input.active ?? true,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create vehicle.");
  const id = branded<"VehicleId">(row.id);
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.vehicle.create",
    targetType: "vehicle",
    targetId: id,
    metadata: { name: input.name.trim() },
  });
  return id;
}

/** Update a vehicle (workspace-isolated). Throws if not found. */
export async function updateVehicle(
  workspaceId: WorkspaceId,
  vehicleId: VehicleId,
  patch: VehiclePatch,
  actorId: UserId,
  expectedUpdatedAt?: string,
): Promise<void> {
  const supabase = getDataClient();
  const set: {
    updated_at: string;
    mobile_expected_updated_at?: string;
    name?: string;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    odometer_km?: number | null;
    active?: boolean;
  } = {
    updated_at: new Date().toISOString(),
    ...(expectedUpdatedAt !== undefined ? { mobile_expected_updated_at: expectedUpdatedAt } : {}),
  };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.make !== undefined) set.make = patch.make ?? null;
  if (patch.model !== undefined) set.model = patch.model ?? null;
  if (patch.year !== undefined) set.year = patch.year ?? null;
  if (patch.odometerKm !== undefined) set.odometer_km = patch.odometerKm ?? null;
  if (patch.active !== undefined) set.active = patch.active;
  const rows = await unwrap(
    supabase
      .from("vehicles")
      .update(set)
      .eq("id", vehicleId)
      .eq("workspace_id", workspaceId)
      .select("id"),
  );
  if (!rows[0]) throw new Error("Vehicle not found.");
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.vehicle.update",
    targetType: "vehicle",
    targetId: vehicleId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** Hard-delete a vehicle (cascade-deletes its expenses). Returns false if not found. */
export async function deleteVehicle(
  workspaceId: WorkspaceId,
  vehicleId: VehicleId,
  actorId: UserId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("vehicles")
      .delete()
      .eq("id", vehicleId)
      .eq("workspace_id", workspaceId)
      .select("id, name"),
  );
  const row = rows[0];
  if (!row) return false;
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.vehicle.delete",
    targetType: "vehicle",
    targetId: vehicleId,
    metadata: { name: row.name },
  });
  return true;
}

/** List vehicles for a workspace (active first, then newest). */
export async function listVehicles(workspaceId: WorkspaceId): Promise<VehicleRow[]> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("vehicles")
      .select(VEHICLE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("active", { ascending: false })
      .order("created_at", { ascending: false }),
  );
  return rows.map((r) => toVehicleRow(r as VehicleRaw));
}

/** Fetch a single vehicle, workspace-scoped (IDOR-safe). */
export async function getVehicle(
  workspaceId: WorkspaceId,
  vehicleId: VehicleId,
): Promise<VehicleRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("vehicles")
      .select(VEHICLE_COLUMNS)
      .eq("id", vehicleId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toVehicleRow(row as VehicleRaw) : null;
}

// ─────────────────────── Vehicle expenses (Wave 2) ────────────────────────────

const EXPENSE_COLUMNS =
  "id, workspace_id, vehicle_id, type, amount_cents, currency, date, description, odometer_km, notes, receipt_file_id, created_at, updated_at";

interface ExpenseRaw {
  id: string;
  workspace_id: string;
  vehicle_id: string;
  type: string;
  amount_cents: number;
  currency: string;
  date: string;
  description: string;
  odometer_km: number | null;
  notes: string | null;
  receipt_file_id: string | null;
  created_at: string;
  updated_at: string;
}

function toExpenseRow(r: ExpenseRaw): ExpenseRow {
  return {
    id: branded<"DriveExpenseId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    vehicleId: branded<"VehicleId">(r.vehicle_id),
    type: r.type as VehicleExpenseType,
    amountCents: r.amount_cents,
    currency: r.currency,
    date: parsePgTimestamp(r.date),
    description: r.description,
    odometerKm: r.odometer_km,
    notes: r.notes,
    receiptFileId: r.receipt_file_id ? branded<"FileId">(r.receipt_file_id) : null,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/** Verify a vehicle belongs to the workspace (IDOR guard). Throws if not found. */
async function assertVehicleInWorkspace(
  workspaceId: WorkspaceId,
  vehicleId: VehicleId,
): Promise<void> {
  const v = await getVehicle(workspaceId, vehicleId);
  if (!v) throw new Error("Vehicle not found in this workspace.");
}

/**
 * Create a vehicle expense. Validates the vehicle is in the workspace, publishes
 * `VehicleExpenseLogged` (→ Books expense integration, idempotent on `sourceExpenseId`),
 * and audits.
 */
export async function createExpense(
  workspaceId: WorkspaceId,
  input: ExpenseInput,
  actorId: UserId,
  deterministicId?: DriveExpenseId,
): Promise<DriveExpenseId> {
  if (input.amountCents <= 0) throw new Error("Amount must be greater than 0.");
  await assertVehicleInWorkspace(workspaceId, input.vehicleId);

  const workspace = await getWorkspace(workspaceId);
  const currency = input.currency ?? workspace?.defaultCurrency ?? "AUD";
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("driver_vehicle_expenses")
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        vehicle_id: input.vehicleId,
        type: input.type,
        amount_cents: input.amountCents,
        currency,
        date: input.date.toISOString(),
        description: input.description.trim(),
        odometer_km: input.odometerKm ?? null,
        notes: input.notes ?? null,
        receipt_file_id: input.receiptFileId ?? null,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create vehicle expense.");
  const id = branded<"DriveExpenseId">(row.id);

  await publishEvent({
    type: "VehicleExpenseLogged",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_expense",
    entityId: id,
    metadata: {
      expenseId: id,
      vehicleId: input.vehicleId,
      type: input.type,
      amountCents: input.amountCents,
      currency,
      date: input.date,
      description: input.description.trim(),
      receiptFileId: input.receiptFileId ?? null,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.expense.create",
    targetType: "drive_expense",
    targetId: id,
    metadata: { vehicleId: input.vehicleId, type: input.type, amountCents: input.amountCents },
  });
  return id;
}

/** Update a vehicle expense (workspace-isolated). Throws if not found. No event (silent edit). */
export async function updateExpense(
  workspaceId: WorkspaceId,
  expenseId: DriveExpenseId,
  patch: ExpensePatch,
  actorId: UserId,
  expectedUpdatedAt?: string,
): Promise<void> {
  if (patch.amountCents !== undefined && patch.amountCents <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  const supabase = getDataClient();
  const set: {
    updated_at: string;
    mobile_expected_updated_at?: string;
    type?: VehicleExpenseType;
    amount_cents?: number;
    currency?: string;
    date?: string;
    description?: string;
    odometer_km?: number | null;
    notes?: string | null;
    receipt_file_id?: FileId | null;
  } = {
    updated_at: new Date().toISOString(),
    ...(expectedUpdatedAt !== undefined ? { mobile_expected_updated_at: expectedUpdatedAt } : {}),
  };
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.amountCents !== undefined) set.amount_cents = patch.amountCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.date !== undefined) set.date = patch.date.toISOString();
  if (patch.description !== undefined) set.description = patch.description.trim();
  if (patch.odometerKm !== undefined) set.odometer_km = patch.odometerKm ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.receiptFileId !== undefined) set.receipt_file_id = patch.receiptFileId ?? null;

  const rows = await unwrap(
    supabase
      .from("driver_vehicle_expenses")
      .update(set)
      .eq("id", expenseId)
      .eq("workspace_id", workspaceId)
      .select("id, vehicle_id, type, amount_cents, currency, date, description, receipt_file_id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Vehicle expense not found.");
  await publishEvent({
    type: "VehicleExpenseUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_expense",
    entityId: branded<"DriveExpenseId">(row.id),
    metadata: {
      expenseId: row.id,
      vehicleId: branded<"VehicleId">(row.vehicle_id),
      type: row.type as VehicleExpenseType,
      amountCents: row.amount_cents,
      currency: row.currency,
      date: parsePgTimestamp(row.date),
      description: row.description,
      receiptFileId: row.receipt_file_id,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.expense.update",
    targetType: "drive_expense",
    targetId: expenseId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** Hard-delete a vehicle expense (workspace-isolated). Returns false if not found. */
export async function deleteExpense(
  workspaceId: WorkspaceId,
  expenseId: DriveExpenseId,
  actorId: UserId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("driver_vehicle_expenses")
      .delete()
      .eq("id", expenseId)
      .eq("workspace_id", workspaceId)
      .select("id, type, amount_cents"),
  );
  const row = rows[0];
  if (!row) return false;
  await publishEvent({
    type: "VehicleExpenseDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_expense",
    entityId: branded<"DriveExpenseId">(row.id),
    metadata: { expenseId: row.id },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.expense.delete",
    targetType: "drive_expense",
    targetId: expenseId,
    metadata: { type: row.type as VehicleExpenseType, amountCents: row.amount_cents },
  });
  return true;
}

/** List vehicle expenses for a workspace, optionally filtered by vehicle/search/date range. */
export async function listExpenses(
  workspaceId: WorkspaceId,
  opts?: {
    vehicleId?: VehicleId;
    type?: VehicleExpenseType;
    /** Leading-wildcard ILIKE on `description` + `notes` (index-backed via `pg_trgm` - migration 0017). */
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    offset?: number;
    limit?: number;
  },
): Promise<ExpenseRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 2000);
  let query = supabase
    .from("driver_vehicle_expenses")
    .select(EXPENSE_COLUMNS)
    .eq("workspace_id", workspaceId);
  if (opts?.vehicleId) query = query.eq("vehicle_id", opts.vehicleId);
  if (opts?.type) query = query.eq("type", opts.type);
  if (opts?.dateFrom) query = query.gte("date", opts.dateFrom.toISOString());
  if (opts?.dateTo) query = query.lte("date", opts.dateTo.toISOString());
  const search = opts?.search?.trim();
  if (search) {
    const term = pgQuote(`%${search}%`);
    query = query.or(`description.ilike.${term},notes.ilike.${term}`);
  }
  const rows = await unwrap(
    query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(Math.max(0, opts?.offset ?? 0), Math.max(0, opts?.offset ?? 0) + limit - 1),
  );
  return rows.map((r) => toExpenseRow(r as ExpenseRaw));
}

/** Fetch a single vehicle expense, workspace-scoped (IDOR-safe). */
export async function getExpense(
  workspaceId: WorkspaceId,
  expenseId: DriveExpenseId,
): Promise<ExpenseRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("driver_vehicle_expenses")
      .select(EXPENSE_COLUMNS)
      .eq("id", expenseId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toExpenseRow(row as ExpenseRaw) : null;
}

// ──────────────────────── Drive settings (Wave 2) ────────────────────────────

/**
 * Get the workspace's drive settings (mileage rate + default vehicle). Returns sensible
 * defaults (ATO 85c/km, no default vehicle) when no row exists yet - callers don't need to
 * distinguish "unset" from "set to defaults".
 */
export async function getDriveSettings(workspaceId: WorkspaceId): Promise<DriveSettingsRow> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("driver_profiles")
      .select("mileage_rate_cents_per_km, default_vehicle_id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!row) return { mileageRateCentsPerKm: 85, defaultVehicleId: null };
  return {
    mileageRateCentsPerKm: row.mileage_rate_cents_per_km,
    defaultVehicleId: row.default_vehicle_id ? branded<"VehicleId">(row.default_vehicle_id) : null,
  };
}

/** Upsert the workspace's drive settings (creates the single row if absent). */
export async function upsertDriveSettings(
  workspaceId: WorkspaceId,
  input: { mileageRateCentsPerKm?: number; defaultVehicleId?: VehicleId | null },
  actorId: UserId,
): Promise<void> {
  if (input.mileageRateCentsPerKm !== undefined && input.mileageRateCentsPerKm < 0) {
    throw new Error("Mileage rate must not be negative.");
  }
  const supabase = getDataClient();
  const existing = await unwrapMaybe(
    supabase
      .from("driver_profiles")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  const set: {
    updated_at: string;
    mileage_rate_cents_per_km?: number;
    default_vehicle_id?: VehicleId | null;
  } = { updated_at: new Date().toISOString() };
  if (input.mileageRateCentsPerKm !== undefined)
    set.mileage_rate_cents_per_km = input.mileageRateCentsPerKm;
  if (input.defaultVehicleId !== undefined) set.default_vehicle_id = input.defaultVehicleId ?? null;
  if (existing) {
    await unwrapVoid(supabase.from("driver_profiles").update(set).eq("id", existing.id));
  } else {
    await unwrapVoid(
      supabase.from("driver_profiles").insert({
        workspace_id: workspaceId,
        mileage_rate_cents_per_km: input.mileageRateCentsPerKm ?? 85,
        default_vehicle_id: input.defaultVehicleId ?? null,
      }),
    );
  }
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.settings.update",
    targetType: "driver_profile",
    targetId: existing ? branded<"DriverProfileId">(existing.id) : undefined,
    metadata: {
      mileageRateCentsPerKm: input.mileageRateCentsPerKm,
      defaultVehicleId: input.defaultVehicleId ?? null,
    },
  });
}

// ─────────────────────────── Backfill (Wave 5) ──────────────────────────────

/**
 * Re-publish `DriveEarningsLogged` / `VehicleExpenseLogged` / `MileageLogged` for every
 * existing Drive row in the workspace. This remains idempotent for manual repair and rollout
 * compatibility. Normal create/update/delete sync and Books-enable backfill now run atomically in
 * Postgres, so application startup no longer orchestrates this replay.
 */
export async function replayDriveEventsForBooks(
  workspaceId: WorkspaceId,
  actorId?: UserId,
): Promise<void> {
  const [earnings, expenses, trips, settings, workspace] = await Promise.all([
    listEarnings(workspaceId, { limit: 2000 }),
    listExpenses(workspaceId, { limit: 2000 }),
    listTrips(workspaceId, { limit: 2000 }),
    getDriveSettings(workspaceId),
    getWorkspace(workspaceId),
  ]);

  for (const e of earnings) {
    await publishEvent({
      type: "DriveEarningsLogged",
      workspaceId,
      actorUserId: actorId,
      entityType: "drive_earning",
      entityId: e.id,
      metadata: {
        platform: e.platform,
        amountCents: e.amountCents,
        currency: e.currency,
        date: e.date,
        description: e.description,
      },
    });
  }
  for (const x of expenses) {
    await publishEvent({
      type: "VehicleExpenseLogged",
      workspaceId,
      actorUserId: actorId,
      entityType: "drive_expense",
      entityId: x.id,
      metadata: {
        expenseId: x.id,
        vehicleId: x.vehicleId,
        type: x.type,
        amountCents: x.amountCents,
        currency: x.currency,
        date: x.date,
        description: x.description,
        receiptFileId: x.receiptFileId,
      },
    });
  }
  for (const t of trips) {
    await publishEvent({
      type: "MileageLogged",
      workspaceId,
      actorUserId: actorId,
      entityType: "drive_trip",
      entityId: t.id,
      metadata: {
        tripId: t.id,
        platform: t.platform,
        distanceMeters: t.distanceMeters,
        date: t.date,
        amountCents: mileageAmountCents(t.distanceMeters, settings.mileageRateCentsPerKm),
        currency: workspace?.defaultCurrency ?? "AUD",
      },
    });
  }
}
