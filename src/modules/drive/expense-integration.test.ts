import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  activityEvents,
  auditLogs,
  bookTransactions as bookTransactionsTable,
  driveEarnings as driveEarningsTable,
  driveTrips as driveTripsTable,
  driverProfiles,
  driverVehicleExpenses,
  moduleInstallations,
  users as usersTable,
  vehicles as vehiclesTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import {
  branded,
  type DriveExpenseId,
  type DriveTripId,
  type VehicleId,
  type WorkspaceId,
} from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { enableModule } from "@/platform/module-installations";
import { clearEventBus, publishEvent } from "@/server/events";
import {
  createEarning,
  createExpense,
  createTrip,
  createVehicle,
  deleteExpense,
  deleteTrip,
  replayDriveEventsForBooks,
  updateExpense,
  updateTrip,
} from "./index";
import { registerBooksIntegration } from "@/modules/books/integration";

/**
 * Integration tests for the Books `VehicleExpenseLogged` cross-module subscriber (Wave 2 —
 * the second Drive→Books integration, after `DriveEarningsLogged`→income). A vehicle
 * expense logged in Drive records a `vehicle_expense` Books transaction, idempotent on
 * `sourceExpenseId`. Run only when DATABASE_URL is set; skipped otherwise.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("books VehicleExpenseLogged integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000d1");
  let ws1: WorkspaceId; // Books + Drive enabled
  let ws2: WorkspaceId; // Drive only — Books NOT enabled (module-gate no-op)
  let ws1Vehicle: VehicleId;
  let ws2Vehicle: VehicleId;
  const createdExpenseIds: DriveExpenseId[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(usersTable)
      .values([
        { id: actor, email: "drive-expense-int@soletrade-test.local", fullName: "Drive Expense Int" },
      ]);
    ws1 = await createWorkspace(actor, "Drive Expense Int One", `drive-exp-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Drive Expense Int Two", `drive-exp-two-${Date.now()}`);
    await enableModule(ws1, "books", actor);
    await enableModule(ws1, "drive", actor);
    await enableModule(ws2, "drive", actor);
    clearEventBus();
    unsub = registerBooksIntegration();
    ws1Vehicle = await createVehicle(ws1, { name: "Prius" }, actor);
    ws2Vehicle = await createVehicle(ws2, { name: "Hiace" }, actor);
  });

  afterAll(async () => {
    const db = getDb();
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) return;
    // bookTransactions reference workspace (no cascade) — delete first.
    await db
      .delete(bookTransactionsTable)
      .where(inArray(bookTransactionsTable.workspaceId, workspaceIds));
    await db
      .delete(driveTripsTable)
      .where(inArray(driveTripsTable.workspaceId, workspaceIds));
    await db
      .delete(driveEarningsTable)
      .where(inArray(driveEarningsTable.workspaceId, workspaceIds));
    // driverVehicleExpenses cascade their vehicle FK, but delete explicitly to be safe.
    await db
      .delete(driverVehicleExpenses)
      .where(inArray(driverVehicleExpenses.workspaceId, workspaceIds));
    await db.delete(driverProfiles).where(inArray(driverProfiles.workspaceId, workspaceIds));
    await db.delete(vehiclesTable).where(inArray(vehiclesTable.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(activityEvents).where(inArray(activityEvents.workspaceId, workspaceIds));
    await db
      .delete(moduleInstallations)
      .where(inArray(moduleInstallations.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(eq(usersTable.id, actor));
  });

  /** Count Books expense rows linked to a given drive expense in a workspace. */
  async function countExpenseForDriveExpense(
    workspaceId: WorkspaceId,
    expenseId: DriveExpenseId,
  ): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ id: bookTransactionsTable.id })
      .from(bookTransactionsTable)
      .where(
        and(
          eq(bookTransactionsTable.workspaceId, workspaceId),
          eq(bookTransactionsTable.sourceExpenseId, expenseId),
        ),
      );
    return rows.length;
  }

  /** Fetch the (single) Books expense row linked to a drive expense, or null. */
  async function getExpenseForDriveExpense(workspaceId: WorkspaceId, expenseId: DriveExpenseId) {
    const db = getDb();
    const rows = await db
      .select()
      .from(bookTransactionsTable)
      .where(
        and(
          eq(bookTransactionsTable.workspaceId, workspaceId),
          eq(bookTransactionsTable.sourceExpenseId, expenseId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  it("records a Books vehicle_expense when a Drive vehicle expense is logged (happy path)", async () => {
    const expenseId = await createExpense(
      ws1!,
      {
        vehicleId: ws1Vehicle!,
        type: "fuel",
        amountCents: 8750,
        currency: "AUD",
        date: new Date("2026-07-03"),
        description: "Fill up — 40L unleaded",
      },
      actor,
    );
    createdExpenseIds.push(expenseId);

    const row = await getExpenseForDriveExpense(ws1!, expenseId);
    expect(row).not.toBeNull();
    expect(row!.type).toBe("expense");
    expect(row!.category).toBe("vehicle_expense");
    expect(row!.amountCents).toBe(8750);
    expect(row!.currency).toBe("AUD");
    expect(row!.customerId).toBeNull();
    expect(row!.sourceExpenseId).toBe(expenseId);
    expect(row!.date.toISOString()).toBe(new Date("2026-07-03").toISOString());
    expect(row!.description).toBe("Fill up — 40L unleaded");
    expect(row!.notes).toBe("Auto-recorded from drive vehicle expense.");
  });

  it("is idempotent — a replayed VehicleExpenseLogged does not duplicate the expense row", async () => {
    const expenseId = createdExpenseIds[0]!;
    const before = await countExpenseForDriveExpense(ws1!, expenseId);
    expect(before).toBe(1);

    // Manually replay a VehicleExpenseLogged for the same expense (simulates a redelivery).
    await publishEvent({
      type: "VehicleExpenseLogged",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "drive_expense",
      entityId: expenseId,
      metadata: {
        expenseId,
        vehicleId: ws1Vehicle,
        type: "fuel",
        amountCents: 8750,
        currency: "AUD",
        date: new Date("2026-07-03"),
        description: "Fill up — 40L unleaded",
      },
    });

    const after = await countExpenseForDriveExpense(ws1!, expenseId);
    expect(after).toBe(1); // unchanged
  });

  it("does not record an expense when Books is not installed (module gate)", async () => {
    const expenseId = await createExpense(
      ws2!,
      {
        vehicleId: ws2Vehicle!,
        type: "maintenance",
        amountCents: 32000,
        currency: "AUD",
        date: new Date("2026-07-04"),
        description: "Service + tyres",
      },
      actor,
    );
    createdExpenseIds.push(expenseId);

    const count = await countExpenseForDriveExpense(ws2!, expenseId);
    expect(count).toBe(0);
  });

  it("ignores a VehicleExpenseLogged event with missing metadata (no throw, no row)", async () => {
    const before = await dbRowCountForWorkspace(ws1!);
    // Garbage metadata — no amountCents/currency/date.
    await publishEvent({
      type: "VehicleExpenseLogged",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "drive_expense",
      entityId: "00000000-0000-9000-8000-00000000bee3",
      metadata: { junk: true },
    });
    const after = await dbRowCountForWorkspace(ws1!);
    expect(after).toBe(before); // no new row
  });

  // ─────────── Wave 5: vehicle-expense edit/delete sync ("Drive wins") ───────────

  it("updates the mirrored Books expense row when a Drive vehicle expense is edited", async () => {
    const expenseId = await createExpense(
      ws1!,
      {
        vehicleId: ws1Vehicle!,
        type: "fuel",
        amountCents: 6000,
        currency: "AUD",
        date: new Date("2026-07-05"),
        description: "Original fuel",
      },
      actor,
    );
    createdExpenseIds.push(expenseId);

    await updateExpense(
      ws1!,
      expenseId,
      { amountCents: 9000, description: "Revised fuel", date: new Date("2026-07-06") },
      actor,
    );

    const row = await getExpenseForDriveExpense(ws1!, expenseId);
    expect(row).not.toBeNull();
    expect(row!.amountCents).toBe(9000);
    expect(row!.description).toBe("Revised fuel");
    expect(row!.date.toISOString()).toBe(new Date("2026-07-06").toISOString());
    expect(row!.category).toBe("vehicle_expense");
    expect(row!.sourceExpenseId).toBe(expenseId);
  });

  it("deletes the mirrored Books expense row when a Drive vehicle expense is deleted", async () => {
    const expenseId = await createExpense(
      ws1!,
      {
        vehicleId: ws1Vehicle!,
        type: "maintenance",
        amountCents: 12000,
        currency: "AUD",
        date: new Date("2026-07-07"),
        description: "To delete",
      },
      actor,
    );
    createdExpenseIds.push(expenseId);
    expect(await countExpenseForDriveExpense(ws1!, expenseId)).toBe(1);

    const ok = await deleteExpense(ws1!, expenseId, actor);
    expect(ok).toBe(true);
    expect(await countExpenseForDriveExpense(ws1!, expenseId)).toBe(0);
    const idx = createdExpenseIds.indexOf(expenseId);
    if (idx >= 0) createdExpenseIds.splice(idx, 1);
  });

  // ───────────────── Wave 5: mileage → Books expense ──────────────────

  /** Fetch the (single) Books mileage expense row linked to a trip, or null. */
  async function getMileageForTrip(workspaceId: WorkspaceId, tripId: DriveTripId) {
    const db = getDb();
    const rows = await db
      .select()
      .from(bookTransactionsTable)
      .where(
        and(
          eq(bookTransactionsTable.workspaceId, workspaceId),
          eq(bookTransactionsTable.sourceTripId, tripId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async function countMileageForTrip(workspaceId: WorkspaceId, tripId: DriveTripId): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ id: bookTransactionsTable.id })
      .from(bookTransactionsTable)
      .where(
        and(
          eq(bookTransactionsTable.workspaceId, workspaceId),
          eq(bookTransactionsTable.sourceTripId, tripId),
        ),
      );
    return rows.length;
  }

  it("records a Books mileage expense when a Drive trip is logged (happy path)", async () => {
    // Default mileage rate is 85c/km → 50km = $42.50 (4250c).
    const tripId = await createTrip(
      ws1!,
      {
        platform: "uber",
        distanceMeters: 50000,
        date: new Date("2026-07-08"),
        purpose: "City loop",
      },
      actor,
    );

    const row = await getMileageForTrip(ws1!, tripId);
    expect(row).not.toBeNull();
    expect(row!.type).toBe("expense");
    expect(row!.category).toBe("mileage");
    expect(row!.amountCents).toBe(4250);
    expect(row!.currency).toBe("AUD");
    expect(row!.customerId).toBeNull();
    expect(row!.sourceTripId).toBe(tripId);
    expect(row!.date.toISOString()).toBe(new Date("2026-07-08").toISOString());
    expect(row!.description).toBe("Drive mileage · Uber");
    expect(row!.notes).toBe("Auto-recorded from drive mileage (Uber).");
  });

  it("updates the mirrored Books mileage row when a trip is edited", async () => {
    const tripId = await createTrip(
      ws1!,
      {
        platform: "uber",
        distanceMeters: 20000, // 20km → $17.00 (1700c)
        date: new Date("2026-07-09"),
        purpose: "Short",
      },
      actor,
    );
    expect((await getMileageForTrip(ws1!, tripId))!.amountCents).toBe(1700);

    await updateTrip(
      ws1!,
      tripId,
      { distanceMeters: 60000, date: new Date("2026-07-10") }, // 60km → $51.00 (5100c)
      actor,
    );

    const row = await getMileageForTrip(ws1!, tripId);
    expect(row!.amountCents).toBe(5100);
    expect(row!.date.toISOString()).toBe(new Date("2026-07-10").toISOString());
    expect(row!.category).toBe("mileage");
    expect(row!.sourceTripId).toBe(tripId);
  });

  it("deletes the mirrored Books mileage row when a trip is deleted", async () => {
    const tripId = await createTrip(
      ws1!,
      {
        platform: "doordash",
        distanceMeters: 10000,
        date: new Date("2026-07-11"),
        purpose: "To delete",
      },
      actor,
    );
    expect(await countMileageForTrip(ws1!, tripId)).toBe(1);

    const ok = await deleteTrip(ws1!, tripId, actor);
    expect(ok).toBe(true);
    expect(await countMileageForTrip(ws1!, tripId)).toBe(0);
  });

  // ───────────────── Wave 5: backfill when Books is enabled later ─────────────────

  it("backfills Books rows for existing Drive entries when Books is enabled (idempotent)", async () => {
    // ws2 has Drive enabled, Books NOT enabled — entries logged now don't mirror.
    const earningId = await createEarning(
      ws2!,
      {
        platform: "uber",
        amountCents: 22000,
        currency: "AUD",
        date: new Date("2026-07-12"),
        description: "Pre-books earning",
      },
      actor,
    );
    const expenseId = await createExpense(
      ws2!,
      {
        vehicleId: ws2Vehicle!,
        type: "fuel",
        amountCents: 7700,
        currency: "AUD",
        date: new Date("2026-07-12"),
        description: "Pre-books expense",
      },
      actor,
    );
    createdExpenseIds.push(expenseId);
    const tripId = await createTrip(
      ws2!,
      {
        platform: "uber",
        distanceMeters: 30000, // 30km → $25.50 (2550c)
        date: new Date("2026-07-12"),
        purpose: "Pre-books trip",
      },
      actor,
    );

    // Nothing mirrored yet — Books isn't installed on ws2.
    expect(await countExpenseForDriveExpense(ws2!, expenseId)).toBe(0);

    // Enable Books, then replay the Drive events (the instrumentation.ts ModuleEnabled glue
    // calls this; here we invoke it directly to test the backfill mechanism).
    await enableModule(ws2!, "books", actor);
    await replayDriveEventsForBooks(ws2!, actor);

    // All three entry types now have mirrored Books rows.
    const incomeRow = await getDb()
      .select()
      .from(bookTransactionsTable)
      .where(eq(bookTransactionsTable.sourceEarningId, earningId))
      .limit(1);
    expect(incomeRow[0]).toBeDefined();
    expect(incomeRow[0]!.type).toBe("income");
    expect(incomeRow[0]!.category).toBe("gig");
    expect(incomeRow[0]!.amountCents).toBe(22000);

    expect((await getExpenseForDriveExpense(ws2!, expenseId))!.amountCents).toBe(7700);
    expect((await getMileageForTrip(ws2!, tripId))!.amountCents).toBe(2550);

    // Replaying again is idempotent — no duplicate rows.
    await replayDriveEventsForBooks(ws2!, actor);
    expect((await countExpenseForDriveExpense(ws2!, expenseId)) as number).toBe(1);
    expect(await countMileageForTrip(ws2!, tripId)).toBe(1);
  });
});

/** Total book_transactions row count for a workspace (used by the missing-metadata test). */
async function dbRowCountForWorkspace(workspaceId: WorkspaceId): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: bookTransactionsTable.id })
    .from(bookTransactionsTable)
    .where(eq(bookTransactionsTable.workspaceId, workspaceId));
  return rows.length;
}
