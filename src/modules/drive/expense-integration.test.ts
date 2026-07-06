import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  activityEvents,
  auditLogs,
  bookTransactions as bookTransactionsTable,
  driverProfiles,
  driverVehicleExpenses,
  moduleInstallations,
  users as usersTable,
  vehicles as vehiclesTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type DriveExpenseId, type VehicleId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { enableModule } from "@/platform/module-installations";
import { clearEventBus, publishEvent } from "@/server/events";
import { createExpense, createVehicle } from "./index";
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
