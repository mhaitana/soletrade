import "server-only";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { driveEarnings, driveTrips } from "@/server/db/schema";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { isDrivePlatform } from "@/shared/constants/drive-platforms";
import type { DriveEarningId, DriveTripId, UserId, WorkspaceId } from "@/shared/types/ids";

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
 * Events fire on **create only** (`DriveEarningsLogged` / `MileageLogged`) — the activity feed
 * shows the meaningful "logged" moment. Edits/deletes are silent (no event) and don't ripple
 * to Books (the `DriveEarningsLogged → Books income` subscriber, in
 * `@/modules/books/integration`, only reacts to the create — a documented no-reversal
 * limitation, same as the 6c InvoicePaid integration). All mutations write audit
 * (`drive.earning.*` / `drive.trip.*`); the action layer does not audit (mirrors Books).
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
    .returning({ id: driveEarnings.id });
  if (!rows[0]) throw new Error("Earning not found.");

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
      platform: input.platform,
      distanceMeters: input.distanceMeters,
      date: input.date,
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
    .returning({ id: driveTrips.id });
  if (!rows[0]) throw new Error("Trip not found.");

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
  formatKm,
} from "./calc";
