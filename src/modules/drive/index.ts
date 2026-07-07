import "server-only";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  driveEarnings,
  driveTrips,
  driverVehicleExpenses,
  driverProfiles,
  vehicles,
} from "@/server/db/schema";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { isDrivePlatform } from "@/shared/constants/drive-platforms";
import type { VehicleExpenseType } from "@/server/db/schema/enums";
import type {
  DriveEarningId,
  DriveExpenseId,
  DriveTripId,
  FileId,
  UserId,
  VehicleId,
  WorkspaceId,
} from "@/shared/types/ids";

/**
 * Drive module service (Phase 7). Workspace-scoped CRUD for gig-economy earnings + mileage
 * trips. All queries filter `eq(<table>.workspaceId, workspaceId)` — never trust a client
 * workspace id; the caller resolves it from the session (`requireWorkspaceContext`).
 *
 * Two independent entity types:
 * - **Earnings** — a dated money entry (platform, amount, currency, description, notes).
 * - **Trips**    — a dated distance entry (platform, distance in meters, purpose, notes).
 *
 * No lifecycle / status — a row is a dated ledger entry. Money is integer cents; distance is
 * integer meters (smallest unit, mirrors the cents pattern). Platforms are slugs from the pure
 * `drive-platforms` catalog, validated here as a defensive guard (the action already
 * validates). Delete is hard-delete + audit-logged; soft-delete is a later phase.
 *
 * Events fire on **every mutation**: creates publish `DriveEarningsLogged` /
 * `VehicleExpenseLogged` / `MileageLogged` (the meaningful "logged" moment for the activity
 * feed), and edits/deletes publish `*Updated` / `*Deleted` so the Books mirror stays in sync
 * (the `@/modules/books/integration` subscribers reconcile the mirrored row — "Drive wins",
 * unconditional overwrite). `MileageLogged` carries the computed deduction amount
 * (distance × workspace mileage rate) so the Books expense row is created at log time. All
 * mutations write audit (`drive.earning.*` / `drive.trip.*`); the action layer does not audit
 * (mirrors Books).
 *
 * `actorId` is **required** for every mutation — earnings/trips are always user-logged, so
 * there is no system-actor path (unlike Books' optional `actorId` for the InvoicePaid
 * subscriber). The audit log + event carry `actorUserId: actorId`.
 */

// ────────────────────────────── Earnings ──────────────────────────────

export interface EarningInput {
  /** Slug from `drive-platforms`, validated. */
  platform: string;
  /** Integer cents, must be > 0. */
  amountCents: number;
  currency?: string;
  /** User-chosen earning date. */
  date: Date;
  description: string;
  notes?: string | null;
}

export type EarningPatch = Partial<EarningInput>;

export interface EarningRow {
  id: DriveEarningId;
  workspaceId: WorkspaceId;
  platform: string;
  amountCents: number;
  currency: string;
  date: Date;
  description: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectEarning = {
  id: driveEarnings.id,
  workspaceId: driveEarnings.workspaceId,
  platform: driveEarnings.platform,
  amountCents: driveEarnings.amountCents,
  currency: driveEarnings.currency,
  date: driveEarnings.date,
  description: driveEarnings.description,
  notes: driveEarnings.notes,
  createdAt: driveEarnings.createdAt,
  updatedAt: driveEarnings.updatedAt,
} as const;

// ─────────────────────────────── Trips ───────────────────────────────

export interface TripInput {
  /** Slug from `drive-platforms`, validated. */
  platform: string;
  /** Integer meters (smallest unit), must be > 0. */
  distanceMeters: number;
  /** User-chosen trip date. */
  date: Date;
  purpose?: string | null;
  notes?: string | null;
}

export type TripPatch = Partial<TripInput>;

export interface TripRow {
  id: DriveTripId;
  workspaceId: WorkspaceId;
  platform: string;
  distanceMeters: number;
  date: Date;
  purpose: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectTrip = {
  id: driveTrips.id,
  workspaceId: driveTrips.workspaceId,
  platform: driveTrips.platform,
  distanceMeters: driveTrips.distanceMeters,
  date: driveTrips.date,
  purpose: driveTrips.purpose,
  notes: driveTrips.notes,
  createdAt: driveTrips.createdAt,
  updatedAt: driveTrips.updatedAt,
} as const;

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
): Promise<DriveEarningId> {
  if (input.amountCents <= 0) throw new Error("Amount must be greater than 0.");
  assertPlatform(input.platform);

  const db = getDb();
  const rows = await db
    .insert(driveEarnings)
    .values({
      workspaceId,
      platform: input.platform,
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      date: input.date,
      description: input.description.trim(),
      notes: input.notes ?? null,
    })
    .returning({ id: driveEarnings.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create earning.");

  await publishEvent({
    type: "DriveEarningsLogged",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_earning",
    entityId: row.id,
    metadata: {
      platform: input.platform,
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      date: input.date,
      description: input.description.trim(),
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.earning.create",
    targetType: "drive_earning",
    targetId: row.id,
    metadata: { platform: input.platform, amountCents: input.amountCents },
  });
  return row.id;
}

/** Update an earning (workspace-isolated). Throws if not found. No event (silent edit). */
export async function updateEarning(
  workspaceId: WorkspaceId,
  earningId: DriveEarningId,
  patch: EarningPatch,
  actorId: UserId,
): Promise<void> {
  if (patch.platform !== undefined) assertPlatform(patch.platform);
  if (patch.amountCents !== undefined && patch.amountCents <= 0) {
    throw new Error("Amount must be greater than 0.");
  }

  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.platform !== undefined) set.platform = patch.platform;
  if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.description !== undefined) set.description = patch.description.trim();
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;

  const rows = await db
    .update(driveEarnings)
    .set(set)
    .where(and(eq(driveEarnings.id, earningId), eq(driveEarnings.workspaceId, workspaceId)))
    .returning({
      id: driveEarnings.id,
      platform: driveEarnings.platform,
      amountCents: driveEarnings.amountCents,
      currency: driveEarnings.currency,
      date: driveEarnings.date,
      description: driveEarnings.description,
    });
  const row = rows[0];
  if (!row) throw new Error("Earning not found.");

  await publishEvent({
    type: "DriveEarningUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_earning",
    entityId: row.id,
    metadata: {
      earningId: row.id,
      platform: row.platform,
      amountCents: row.amountCents,
      currency: row.currency,
      date: row.date,
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
  const db = getDb();
  const rows = await db
    .delete(driveEarnings)
    .where(and(eq(driveEarnings.id, earningId), eq(driveEarnings.workspaceId, workspaceId)))
    .returning({
      id: driveEarnings.id,
      platform: driveEarnings.platform,
      amountCents: driveEarnings.amountCents,
    });
  const row = rows[0];
  if (!row) return false;

  await publishEvent({
    type: "DriveEarningDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_earning",
    entityId: row.id,
    metadata: { earningId: row.id },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.earning.delete",
    targetType: "drive_earning",
    targetId: earningId,
    metadata: { platform: row.platform, amountCents: row.amountCents },
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
    limit?: number;
  },
): Promise<EarningRow[]> {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 2000);
  const conditions: (SQL | undefined)[] = [eq(driveEarnings.workspaceId, workspaceId)];
  if (opts?.platform) conditions.push(eq(driveEarnings.platform, opts.platform));
  if (opts?.dateFrom) conditions.push(gte(driveEarnings.date, opts.dateFrom));
  if (opts?.dateTo) conditions.push(lte(driveEarnings.date, opts.dateTo));
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(driveEarnings.description, term), ilike(driveEarnings.notes, term)));
  }

  return db
    .select(selectEarning)
    .from(driveEarnings)
    .where(and(...conditions))
    .orderBy(desc(driveEarnings.date), desc(driveEarnings.createdAt))
    .limit(limit);
}

/**
 * Fetch a single earning, scoped to the workspace. IDOR-safe — returns null when the earning
 * belongs to another workspace.
 */
export async function getEarning(
  workspaceId: WorkspaceId,
  earningId: DriveEarningId,
): Promise<EarningRow | null> {
  const db = getDb();
  const rows = await db
    .select(selectEarning)
    .from(driveEarnings)
    .where(and(eq(driveEarnings.id, earningId), eq(driveEarnings.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

// ───────────────────────────── Trips CRUD ──────────────────────────────

/** Create a trip. Validates the platform + publishes `MileageLogged` + audits. */
export async function createTrip(
  workspaceId: WorkspaceId,
  input: TripInput,
  actorId: UserId,
): Promise<DriveTripId> {
  if (input.distanceMeters <= 0) throw new Error("Distance must be greater than 0.");
  assertPlatform(input.platform);

  const settings = await getDriveSettings(workspaceId);
  const amountCents = mileageAmountCents(input.distanceMeters, settings.mileageRateCentsPerKm);

  const db = getDb();
  const rows = await db
    .insert(driveTrips)
    .values({
      workspaceId,
      platform: input.platform,
      distanceMeters: input.distanceMeters,
      date: input.date,
      purpose: input.purpose ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: driveTrips.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create trip.");

  await publishEvent({
    type: "MileageLogged",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_trip",
    entityId: row.id,
    metadata: {
      tripId: row.id,
      platform: input.platform,
      distanceMeters: input.distanceMeters,
      date: input.date,
      amountCents,
      currency: "AUD",
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.trip.create",
    targetType: "drive_trip",
    targetId: row.id,
    metadata: { platform: input.platform, distanceMeters: input.distanceMeters },
  });
  return row.id;
}

/** Update a trip (workspace-isolated). Throws if not found. No event (silent edit). */
export async function updateTrip(
  workspaceId: WorkspaceId,
  tripId: DriveTripId,
  patch: TripPatch,
  actorId: UserId,
): Promise<void> {
  if (patch.platform !== undefined) assertPlatform(patch.platform);
  if (patch.distanceMeters !== undefined && patch.distanceMeters <= 0) {
    throw new Error("Distance must be greater than 0.");
  }

  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.platform !== undefined) set.platform = patch.platform;
  if (patch.distanceMeters !== undefined) set.distanceMeters = patch.distanceMeters;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.purpose !== undefined) set.purpose = patch.purpose ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;

  const rows = await db
    .update(driveTrips)
    .set(set)
    .where(and(eq(driveTrips.id, tripId), eq(driveTrips.workspaceId, workspaceId)))
    .returning({
      id: driveTrips.id,
      platform: driveTrips.platform,
      distanceMeters: driveTrips.distanceMeters,
      date: driveTrips.date,
    });
  const row = rows[0];
  if (!row) throw new Error("Trip not found.");

  // Recompute the deduction with the current workspace mileage rate so the Books mirror
  // stays in step with the Drive page's summary-time calc.
  const settings = await getDriveSettings(workspaceId);
  const amountCents = mileageAmountCents(row.distanceMeters, settings.mileageRateCentsPerKm);
  await publishEvent({
    type: "MileageUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_trip",
    entityId: row.id,
    metadata: {
      tripId: row.id,
      platform: row.platform,
      distanceMeters: row.distanceMeters,
      date: row.date,
      amountCents,
      currency: "AUD",
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
  const db = getDb();
  const rows = await db
    .delete(driveTrips)
    .where(and(eq(driveTrips.id, tripId), eq(driveTrips.workspaceId, workspaceId)))
    .returning({
      id: driveTrips.id,
      platform: driveTrips.platform,
      distanceMeters: driveTrips.distanceMeters,
    });
  const row = rows[0];
  if (!row) return false;

  await publishEvent({
    type: "MileageDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_trip",
    entityId: row.id,
    metadata: { tripId: row.id },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.trip.delete",
    targetType: "drive_trip",
    targetId: tripId,
    metadata: { platform: row.platform, distanceMeters: row.distanceMeters },
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
    limit?: number;
  },
): Promise<TripRow[]> {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 2000);
  const conditions: (SQL | undefined)[] = [eq(driveTrips.workspaceId, workspaceId)];
  if (opts?.platform) conditions.push(eq(driveTrips.platform, opts.platform));
  if (opts?.dateFrom) conditions.push(gte(driveTrips.date, opts.dateFrom));
  if (opts?.dateTo) conditions.push(lte(driveTrips.date, opts.dateTo));
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(driveTrips.purpose, term), ilike(driveTrips.notes, term)));
  }

  return db
    .select(selectTrip)
    .from(driveTrips)
    .where(and(...conditions))
    .orderBy(desc(driveTrips.date), desc(driveTrips.createdAt))
    .limit(limit);
}

/**
 * Fetch a single trip, scoped to the workspace. IDOR-safe — returns null when the trip
 * belongs to another workspace.
 */
export async function getTrip(
  workspaceId: WorkspaceId,
  tripId: DriveTripId,
): Promise<TripRow | null> {
  const db = getDb();
  const rows = await db
    .select(selectTrip)
    .from(driveTrips)
    .where(and(eq(driveTrips.id, tripId), eq(driveTrips.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
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
} from "./calc";

// ───────────────────────────── Vehicles (Wave 2) ─────────────────────────────

export interface VehicleInput {
  name: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  odometerKm?: number | null;
  active?: boolean;
}

export type VehiclePatch = Partial<VehicleInput>;

export interface VehicleRow {
  id: VehicleId;
  workspaceId: WorkspaceId;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometerKm: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const selectVehicle = {
  id: vehicles.id,
  workspaceId: vehicles.workspaceId,
  name: vehicles.name,
  make: vehicles.make,
  model: vehicles.model,
  year: vehicles.year,
  odometerKm: vehicles.odometerKm,
  active: vehicles.active,
  createdAt: vehicles.createdAt,
  updatedAt: vehicles.updatedAt,
} as const;

/** Create a vehicle. */
export async function createVehicle(
  workspaceId: WorkspaceId,
  input: VehicleInput,
  actorId: UserId,
): Promise<VehicleId> {
  if (!input.name.trim()) throw new Error("Vehicle name is required.");
  const db = getDb();
  const rows = await db
    .insert(vehicles)
    .values({
      workspaceId,
      name: input.name.trim(),
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      odometerKm: input.odometerKm ?? null,
      active: input.active ?? true,
    })
    .returning({ id: vehicles.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create vehicle.");
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.vehicle.create",
    targetType: "vehicle",
    targetId: row.id,
    metadata: { name: input.name.trim() },
  });
  return row.id;
}

/** Update a vehicle (workspace-isolated). Throws if not found. */
export async function updateVehicle(
  workspaceId: WorkspaceId,
  vehicleId: VehicleId,
  patch: VehiclePatch,
  actorId: UserId,
): Promise<void> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.make !== undefined) set.make = patch.make ?? null;
  if (patch.model !== undefined) set.model = patch.model ?? null;
  if (patch.year !== undefined) set.year = patch.year ?? null;
  if (patch.odometerKm !== undefined) set.odometerKm = patch.odometerKm ?? null;
  if (patch.active !== undefined) set.active = patch.active;
  const rows = await db
    .update(vehicles)
    .set(set)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.workspaceId, workspaceId)))
    .returning({ id: vehicles.id });
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
  const db = getDb();
  const rows = await db
    .delete(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.workspaceId, workspaceId)))
    .returning({ id: vehicles.id, name: vehicles.name });
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
  const db = getDb();
  return db
    .select(selectVehicle)
    .from(vehicles)
    .where(eq(vehicles.workspaceId, workspaceId))
    .orderBy(desc(vehicles.active), desc(vehicles.createdAt));
}

/** Fetch a single vehicle, workspace-scoped (IDOR-safe). */
export async function getVehicle(
  workspaceId: WorkspaceId,
  vehicleId: VehicleId,
): Promise<VehicleRow | null> {
  const db = getDb();
  const rows = await db
    .select(selectVehicle)
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─────────────────────── Vehicle expenses (Wave 2) ────────────────────────────

export interface ExpenseInput {
  vehicleId: VehicleId;
  type: VehicleExpenseType;
  amountCents: number;
  currency?: string;
  date: Date;
  description: string;
  odometerKm?: number | null;
  notes?: string | null;
  receiptFileId?: FileId | null;
}

export type ExpensePatch = Partial<Omit<ExpenseInput, "vehicleId">>;

export interface ExpenseRow {
  id: DriveExpenseId;
  workspaceId: WorkspaceId;
  vehicleId: VehicleId;
  type: VehicleExpenseType;
  amountCents: number;
  currency: string;
  date: Date;
  description: string;
  odometerKm: number | null;
  notes: string | null;
  receiptFileId: FileId | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectExpense = {
  id: driverVehicleExpenses.id,
  workspaceId: driverVehicleExpenses.workspaceId,
  vehicleId: driverVehicleExpenses.vehicleId,
  type: driverVehicleExpenses.type,
  amountCents: driverVehicleExpenses.amountCents,
  currency: driverVehicleExpenses.currency,
  date: driverVehicleExpenses.date,
  description: driverVehicleExpenses.description,
  odometerKm: driverVehicleExpenses.odometerKm,
  notes: driverVehicleExpenses.notes,
  receiptFileId: driverVehicleExpenses.receiptFileId,
  createdAt: driverVehicleExpenses.createdAt,
  updatedAt: driverVehicleExpenses.updatedAt,
} as const;

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
): Promise<DriveExpenseId> {
  if (input.amountCents <= 0) throw new Error("Amount must be greater than 0.");
  await assertVehicleInWorkspace(workspaceId, input.vehicleId);

  const db = getDb();
  const rows = await db
    .insert(driverVehicleExpenses)
    .values({
      workspaceId,
      vehicleId: input.vehicleId,
      type: input.type,
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      date: input.date,
      description: input.description.trim(),
      odometerKm: input.odometerKm ?? null,
      notes: input.notes ?? null,
      receiptFileId: input.receiptFileId ?? null,
    })
    .returning({ id: driverVehicleExpenses.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create vehicle expense.");

  await publishEvent({
    type: "VehicleExpenseLogged",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_expense",
    entityId: row.id,
    metadata: {
      expenseId: row.id,
      vehicleId: input.vehicleId,
      type: input.type,
      amountCents: input.amountCents,
      currency: input.currency ?? "AUD",
      date: input.date,
      description: input.description.trim(),
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.expense.create",
    targetType: "drive_expense",
    targetId: row.id,
    metadata: { vehicleId: input.vehicleId, type: input.type, amountCents: input.amountCents },
  });
  return row.id;
}

/** Update a vehicle expense (workspace-isolated). Throws if not found. No event (silent edit). */
export async function updateExpense(
  workspaceId: WorkspaceId,
  expenseId: DriveExpenseId,
  patch: ExpensePatch,
  actorId: UserId,
): Promise<void> {
  if (patch.amountCents !== undefined && patch.amountCents <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.description !== undefined) set.description = patch.description.trim();
  if (patch.odometerKm !== undefined) set.odometerKm = patch.odometerKm ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.receiptFileId !== undefined) set.receiptFileId = patch.receiptFileId ?? null;

  const rows = await db
    .update(driverVehicleExpenses)
    .set(set)
    .where(
      and(
        eq(driverVehicleExpenses.id, expenseId),
        eq(driverVehicleExpenses.workspaceId, workspaceId),
      ),
    )
    .returning({
      id: driverVehicleExpenses.id,
      vehicleId: driverVehicleExpenses.vehicleId,
      type: driverVehicleExpenses.type,
      amountCents: driverVehicleExpenses.amountCents,
      currency: driverVehicleExpenses.currency,
      date: driverVehicleExpenses.date,
      description: driverVehicleExpenses.description,
    });
  const row = rows[0];
  if (!row) throw new Error("Vehicle expense not found.");
  await publishEvent({
    type: "VehicleExpenseUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_expense",
    entityId: row.id,
    metadata: {
      expenseId: row.id,
      vehicleId: row.vehicleId,
      type: row.type,
      amountCents: row.amountCents,
      currency: row.currency,
      date: row.date,
      description: row.description,
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
  const db = getDb();
  const rows = await db
    .delete(driverVehicleExpenses)
    .where(
      and(
        eq(driverVehicleExpenses.id, expenseId),
        eq(driverVehicleExpenses.workspaceId, workspaceId),
      ),
    )
    .returning({
      id: driverVehicleExpenses.id,
      type: driverVehicleExpenses.type,
      amountCents: driverVehicleExpenses.amountCents,
    });
  const row = rows[0];
  if (!row) return false;
  await publishEvent({
    type: "VehicleExpenseDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "drive_expense",
    entityId: row.id,
    metadata: { expenseId: row.id },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.expense.delete",
    targetType: "drive_expense",
    targetId: expenseId,
    metadata: { type: row.type, amountCents: row.amountCents },
  });
  return true;
}

/** List vehicle expenses for a workspace, optionally filtered by vehicle/search/date range. */
export async function listExpenses(
  workspaceId: WorkspaceId,
  opts?: {
    vehicleId?: VehicleId;
    type?: VehicleExpenseType;
    /** Leading-wildcard ILIKE on `description` + `notes` (index-backed via `pg_trgm` — migration 0017). */
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
  },
): Promise<ExpenseRow[]> {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 2000);
  const conditions: (SQL | undefined)[] = [eq(driverVehicleExpenses.workspaceId, workspaceId)];
  if (opts?.vehicleId) conditions.push(eq(driverVehicleExpenses.vehicleId, opts.vehicleId));
  if (opts?.type) conditions.push(eq(driverVehicleExpenses.type, opts.type));
  if (opts?.dateFrom) conditions.push(gte(driverVehicleExpenses.date, opts.dateFrom));
  if (opts?.dateTo) conditions.push(lte(driverVehicleExpenses.date, opts.dateTo));
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(ilike(driverVehicleExpenses.description, term), ilike(driverVehicleExpenses.notes, term)),
    );
  }
  return db
    .select(selectExpense)
    .from(driverVehicleExpenses)
    .where(and(...conditions))
    .orderBy(desc(driverVehicleExpenses.date), desc(driverVehicleExpenses.createdAt))
    .limit(limit);
}

/** Fetch a single vehicle expense, workspace-scoped (IDOR-safe). */
export async function getExpense(
  workspaceId: WorkspaceId,
  expenseId: DriveExpenseId,
): Promise<ExpenseRow | null> {
  const db = getDb();
  const rows = await db
    .select(selectExpense)
    .from(driverVehicleExpenses)
    .where(
      and(
        eq(driverVehicleExpenses.id, expenseId),
        eq(driverVehicleExpenses.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ──────────────────────── Drive settings (Wave 2) ────────────────────────────

export interface DriveSettingsRow {
  mileageRateCentsPerKm: number;
  defaultVehicleId: VehicleId | null;
}

/**
 * Get the workspace's drive settings (mileage rate + default vehicle). Returns sensible
 * defaults (ATO 85c/km, no default vehicle) when no row exists yet — callers don't need to
 * distinguish "unset" from "set to defaults".
 */
export async function getDriveSettings(workspaceId: WorkspaceId): Promise<DriveSettingsRow> {
  const db = getDb();
  const rows = await db
    .select({
      mileageRateCentsPerKm: driverProfiles.mileageRateCentsPerKm,
      defaultVehicleId: driverProfiles.defaultVehicleId,
    })
    .from(driverProfiles)
    .where(eq(driverProfiles.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  if (!row) return { mileageRateCentsPerKm: 85, defaultVehicleId: null };
  return {
    mileageRateCentsPerKm: row.mileageRateCentsPerKm,
    defaultVehicleId: row.defaultVehicleId ?? null,
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
  const db = getDb();
  const existing = await db
    .select({ id: driverProfiles.id })
    .from(driverProfiles)
    .where(eq(driverProfiles.workspaceId, workspaceId))
    .limit(1);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.mileageRateCentsPerKm !== undefined)
    set.mileageRateCentsPerKm = input.mileageRateCentsPerKm;
  if (input.defaultVehicleId !== undefined) set.defaultVehicleId = input.defaultVehicleId ?? null;
  if (existing[0]) {
    await db.update(driverProfiles).set(set).where(eq(driverProfiles.id, existing[0].id));
  } else {
    await db.insert(driverProfiles).values({
      workspaceId,
      mileageRateCentsPerKm: input.mileageRateCentsPerKm ?? 85,
      defaultVehicleId: input.defaultVehicleId ?? null,
    });
  }
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "drive.settings.update",
    targetType: "driver_profile",
    targetId: existing[0]?.id,
    metadata: {
      mileageRateCentsPerKm: input.mileageRateCentsPerKm,
      defaultVehicleId: input.defaultVehicleId ?? null,
    },
  });
}

// ─────────────────────────── Backfill (Wave 5) ──────────────────────────────

/**
 * Re-publish `DriveEarningsLogged` / `VehicleExpenseLogged` / `MileageLogged` for every
 * existing Drive row in the workspace. The Books subscribers' check-then-insert makes this
 * idempotent — already-mirrored rows are skipped, missing ones are created. Used when Books
 * is enabled for a workspace that already has Drive entries (the create-time subscribers
 * no-op'd while Books was disabled). Orchestrated from `src/instrumentation.ts` on the
 * `ModuleEnabled` event so the Books module never imports Drive directly (cross-module
 * coupling goes via the bus).
 */
export async function replayDriveEventsForBooks(
  workspaceId: WorkspaceId,
  actorId?: UserId,
): Promise<void> {
  const [earnings, expenses, trips, settings] = await Promise.all([
    listEarnings(workspaceId, { limit: 2000 }),
    listExpenses(workspaceId, { limit: 2000 }),
    listTrips(workspaceId, { limit: 2000 }),
    getDriveSettings(workspaceId),
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
        currency: "AUD",
      },
    });
  }
}
