import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  activityEvents,
  auditLogs,
  bookTransactions as bookTransactionsTable,
  driveEarnings as driveEarningsTable,
  moduleInstallations,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type DriveEarningId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { enableModule } from "@/platform/module-installations";
import { clearEventBus, publishEvent } from "@/server/events";
import { createEarning } from "./index";
import { registerBooksIntegration } from "@/modules/books/integration";

/**
 * Integration tests for the Books `DriveEarningsLogged` cross-module subscriber (Phase 7)
 * against a real Postgres. Run only when DATABASE_URL is set; skipped otherwise.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("books DriveEarningsLogged integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000c1");
  let ws1: WorkspaceId; // Books enabled
  let ws2: WorkspaceId; // Books NOT enabled
  const createdEarningIds: DriveEarningId[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    const db = getDb();
    await db
      .insert(usersTable)
      .values([
        { id: actor, email: "drive-books-int@soletrade-test.local", fullName: "Drive Books Int" },
      ]);
    ws1 = await createWorkspace(actor, "Drive Books Int One", `drive-books-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Drive Books Int Two", `drive-books-two-${Date.now()}`);
    // Only ws1 has Books enabled — ws2 exercises the module-gate no-op.
    await enableModule(ws1, "books", actor);
    await enableModule(ws1, "drive", actor);
    await enableModule(ws2, "drive", actor);
    clearEventBus();
    unsub = registerBooksIntegration();
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
      .delete(driveEarningsTable)
      .where(inArray(driveEarningsTable.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(activityEvents).where(inArray(activityEvents.workspaceId, workspaceIds));
    await db
      .delete(moduleInstallations)
      .where(inArray(moduleInstallations.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(inArray(usersTable.id, [actor]));
  });

  /** Count Books income rows linked to a given earning in a workspace. */
  async function countIncomeForEarning(
    workspaceId: WorkspaceId,
    earningId: DriveEarningId,
  ): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ id: bookTransactionsTable.id })
      .from(bookTransactionsTable)
      .where(
        and(
          eq(bookTransactionsTable.workspaceId, workspaceId),
          eq(bookTransactionsTable.sourceEarningId, earningId),
        ),
      );
    return rows.length;
  }

  /** Fetch the (single) Books income row linked to an earning, or null. */
  async function getIncomeForEarning(workspaceId: WorkspaceId, earningId: DriveEarningId) {
    const db = getDb();
    const rows = await db
      .select()
      .from(bookTransactionsTable)
      .where(
        and(
          eq(bookTransactionsTable.workspaceId, workspaceId),
          eq(bookTransactionsTable.sourceEarningId, earningId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  it("records Books income when a Drive earning is logged (happy path)", async () => {
    const earningId = await createEarning(
      ws1!,
      {
        platform: "uber",
        amountCents: 12050,
        currency: "AUD",
        date: new Date("2026-07-01"),
        description: "Airport run",
      },
      actor,
    );
    createdEarningIds.push(earningId);

    const row = await getIncomeForEarning(ws1!, earningId);
    expect(row).not.toBeNull();
    expect(row!.type).toBe("income");
    expect(row!.category).toBe("gig");
    expect(row!.amountCents).toBe(12050);
    expect(row!.currency).toBe("AUD");
    expect(row!.customerId).toBeNull();
    expect(row!.sourceEarningId).toBe(earningId);
    // Uses the earning's user-chosen date (not event-processing time).
    expect(row!.date.toISOString()).toBe(new Date("2026-07-01").toISOString());
    expect(row!.description).toBe("Drive earnings · Uber");
    expect(row!.notes).toBe("Auto-recorded from drive earnings (Uber).");
  });

  it("is idempotent — a replayed DriveEarningsLogged does not duplicate the income row", async () => {
    const earningId = createdEarningIds[0]!;
    const before = await countIncomeForEarning(ws1!, earningId);
    expect(before).toBe(1);

    // Manually replay a DriveEarningsLogged for the same earning (simulates a queue redelivery).
    await publishEvent({
      type: "DriveEarningsLogged",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "drive_earning",
      entityId: earningId,
      metadata: {
        platform: "uber",
        amountCents: 12050,
        currency: "AUD",
        date: new Date("2026-07-01"),
        description: "Airport run",
      },
    });

    const after = await countIncomeForEarning(ws1!, earningId);
    expect(after).toBe(1); // unchanged
  });

  it("does not record income when Books is not installed (module gate)", async () => {
    const earningId = await createEarning(
      ws2!,
      {
        platform: "doordash",
        amountCents: 8000,
        currency: "AUD",
        date: new Date("2026-07-02"),
        description: "Delivery",
      },
      actor,
    );
    createdEarningIds.push(earningId);

    const count = await countIncomeForEarning(ws2!, earningId);
    expect(count).toBe(0);
  });

  it("ignores a DriveEarningsLogged event with missing metadata (no throw, no row)", async () => {
    const before = await dbRowCountForWorkspace(ws1!);
    // Garbage metadata — no amountCents/currency/platform/date.
    await publishEvent({
      type: "DriveEarningsLogged",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "drive_earning",
      entityId: "00000000-0000-9000-8000-00000000bee2",
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
