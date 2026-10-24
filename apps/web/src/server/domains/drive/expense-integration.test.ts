import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrap, unwrapMaybe, parsePgTimestamp } from "@/server/infrastructure/db/helpers";
import { cleanupWorkspaces, seedUsers, type CleanupTable } from "@/testing/db-helpers";
import {
  branded,
  type DriveExpenseId,
  type DriveTripId,
  type FileId,
  type VehicleId,
  type WorkspaceId,
} from "@/types/ids";
import { createWorkspace } from "@/server/foundation/workspaces";
import { enableModule } from "@/server/foundation/module-installations";
import { clearEventBus, publishEvent } from "@/server/infrastructure/events";
import {
  createEarning,
  createExpense,
  createTrip,
  createVehicle,
  deleteExpense,
  deleteTrip,
  replayDriveEventsForBooks,
  upsertDriveSettings,
  updateExpense,
  updateTrip,
} from "@/server/domains/drive";
import { registerBooksIntegration } from "@/server/domains/books/integration";

/**
 * Integration tests for the Books `VehicleExpenseLogged` cross-module subscriber (Wave 2 -
 * the second Drive→Books integration, after `DriveEarningsLogged`→income). A vehicle
 * expense logged in Drive records a `vehicle_expense` Books transaction, idempotent on
 * `sourceExpenseId`. Run only when DATABASE_URL is set; skipped otherwise.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

/** Shape the assertions use - mapped from the raw snake_case PostgREST row. */
interface BookTxRow {
  type: string;
  category: string;
  amountCents: number;
  currency: string;
  customerId: string | null;
  sourceExpenseId: string | null;
  sourceTripId: string | null;
  receiptFileId: string | null;
  date: Date;
  description: string;
  notes: string | null;
}

/** Map a raw `book_transactions` PostgREST row to the shape the assertions use. */
function mapBookTx(r: Record<string, unknown>): BookTxRow {
  return {
    type: r.type as string,
    category: r.category as string,
    amountCents: r.amount_cents as number,
    currency: r.currency as string,
    customerId: (r.customer_id as string | null) ?? null,
    sourceExpenseId: (r.source_expense_id as string | null) ?? null,
    sourceTripId: (r.source_trip_id as string | null) ?? null,
    receiptFileId: (r.receipt_file_id as string | null) ?? null,
    date: parsePgTimestamp(r.date as string),
    description: r.description as string,
    notes: (r.notes as string | null) ?? null,
  };
}

describe.skipIf(!HAS_DB)("books VehicleExpenseLogged integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000d1");
  let ws1: WorkspaceId; // Books + Drive enabled
  let ws2: WorkspaceId; // Drive only - Books NOT enabled (module-gate no-op)
  let ws1Vehicle: VehicleId;
  let ws2Vehicle: VehicleId;
  const createdExpenseIds: DriveExpenseId[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([
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
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    const tables: CleanupTable[] = [
      // bookTransactions reference workspace (no cascade) - delete first.
      { table: "book_transactions" },
      { table: "drive_trips" },
      { table: "drive_earnings" },
      // driverVehicleExpenses cascade their vehicle FK, but delete explicitly to be safe.
      { table: "driver_vehicle_expenses" },
      { table: "driver_profiles" },
      { table: "vehicles" },
      { table: "audit_logs" },
      { table: "activity_events" },
      { table: "module_installations" },
    ];
    await cleanupWorkspaces(workspaceIds, [actor], tables);
  });

  /** Count Books expense rows linked to a given drive expense in a workspace. */
  async function countExpenseForDriveExpense(
    workspaceId: WorkspaceId,
    expenseId: DriveExpenseId,
  ): Promise<number> {
    const rows = await unwrap(
      getDataClient()
        .from("book_transactions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_expense_id", expenseId),
    );
    return rows.length;
  }

  /** Fetch the (single) Books expense row linked to a drive expense, or null. */
  async function getExpenseForDriveExpense(workspaceId: WorkspaceId, expenseId: DriveExpenseId) {
    const row = await unwrapMaybe(
      getDataClient()
        .from("book_transactions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("source_expense_id", expenseId)
        .limit(1)
        .maybeSingle(),
    );
    return row ? mapBookTx(row as Record<string, unknown>) : null;
  }

  it("records a Books vehicle_expense when a Drive vehicle expense is logged (happy path)", async () => {
    const receiptFileId = branded<"FileId">("00000000-0000-9000-8000-0000000000d2") as FileId;
    const expenseId = await createExpense(
      ws1!,
      {
        vehicleId: ws1Vehicle!,
        type: "fuel",
        amountCents: 8750,
        currency: "AUD",
        date: new Date("2026-07-03"),
        description: "Fill up - 40L unleaded",
        receiptFileId,
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
    expect(row!.description).toBe("Fill up - 40L unleaded");
    expect(row!.notes).toBe("Auto-recorded from drive vehicle expense.");
    expect(row!.receiptFileId).toBe(receiptFileId);
  });

  it("is idempotent - a replayed VehicleExpenseLogged does not duplicate the expense row", async () => {
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
        description: "Fill up - 40L unleaded",
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
    // Garbage metadata - no amountCents/currency/date.
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
    const row = await unwrapMaybe(
      getDataClient()
        .from("book_transactions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("source_trip_id", tripId)
        .limit(1)
        .maybeSingle(),
    );
    return row ? mapBookTx(row as Record<string, unknown>) : null;
  }

  async function countMileageForTrip(
    workspaceId: WorkspaceId,
    tripId: DriveTripId,
  ): Promise<number> {
    const rows = await unwrap(
      getDataClient()
        .from("book_transactions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_trip_id", tripId),
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

  it("recalculates existing mileage rows when the workspace rate changes", async () => {
    const tripId = await createTrip(
      ws1!,
      {
        platform: "uber",
        distanceMeters: 10000,
        date: new Date("2026-07-10"),
        purpose: "Rate test",
      },
      actor,
    );
    expect((await getMileageForTrip(ws1!, tripId))!.amountCents).toBe(850);

    await upsertDriveSettings(ws1!, { mileageRateCentsPerKm: 100 }, actor);
    expect((await getMileageForTrip(ws1!, tripId))!.amountCents).toBe(1000);

    await upsertDriveSettings(ws1!, { mileageRateCentsPerKm: 0 }, actor);
    expect(await getMileageForTrip(ws1!, tripId)).toBeNull();

    await upsertDriveSettings(ws1!, { mileageRateCentsPerKm: 85 }, actor);
    expect((await getMileageForTrip(ws1!, tripId))!.amountCents).toBe(850);
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
    // ws2 has Drive enabled, Books NOT enabled - entries logged now don't mirror.
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

    // Nothing mirrored yet - Books isn't installed on ws2.
    expect(await countExpenseForDriveExpense(ws2!, expenseId)).toBe(0);

    // Enabling Books durably reconciles all existing Drive rows in the database.
    await enableModule(ws2!, "books", actor);

    // All three entry types now have mirrored Books rows.
    const incomeRow = await unwrapMaybe(
      getDataClient()
        .from("book_transactions")
        .select("*")
        .eq("source_earning_id", earningId)
        .limit(1)
        .maybeSingle(),
    );
    expect(incomeRow).toBeDefined();
    expect((incomeRow as Record<string, unknown> | null)!.type).toBe("income");
    expect((incomeRow as Record<string, unknown> | null)!.category).toBe("gig");
    expect((incomeRow as Record<string, unknown> | null)!.amount_cents).toBe(22000);

    expect((await getExpenseForDriveExpense(ws2!, expenseId))!.amountCents).toBe(7700);
    expect((await getMileageForTrip(ws2!, tripId))!.amountCents).toBe(2550);

    // The legacy event replay remains idempotent during the migration window.
    await replayDriveEventsForBooks(ws2!, actor);
    expect(await countExpenseForDriveExpense(ws2!, expenseId)).toBe(1);
    expect(await countMileageForTrip(ws2!, tripId)).toBe(1);
  });
});

/** Total book_transactions row count for a workspace (used by the missing-metadata test). */
async function dbRowCountForWorkspace(workspaceId: WorkspaceId): Promise<number> {
  const rows = await unwrap(
    getDataClient().from("book_transactions").select("id").eq("workspace_id", workspaceId),
  );
  return rows.length;
}
