import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/infrastructure/db/client";
import {
  unwrap,
  unwrapMaybe,
  unwrapVoid,
  parsePgTimestamp,
} from "@/server/infrastructure/db/helpers";
import { cleanupWorkspaces, seedUsers, type CleanupTable } from "@/testing/db-helpers";
import { branded, type DriveEarningId, type WorkspaceId } from "@/types/ids";
import { createWorkspace } from "@/server/foundation/workspaces";
import { enableModule } from "@/server/foundation/module-installations";
import { clearEventBus, publishEvent } from "@/server/infrastructure/events";
import { createEarning, deleteEarning, updateEarning } from "@/server/domains/drive";
import { registerBooksIntegration } from "@/server/domains/books/integration";

/**
 * Integration tests for the Books `DriveEarningsLogged` cross-module subscriber (Phase 7)
 * against a real Postgres. Run only when DATABASE_URL is set; skipped otherwise.
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
  sourceEarningId: string | null;
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
    sourceEarningId: (r.source_earning_id as string | null) ?? null,
    date: parsePgTimestamp(r.date as string),
    description: r.description as string,
    notes: (r.notes as string | null) ?? null,
  };
}

describe.skipIf(!HAS_DB)("books DriveEarningsLogged integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000c1");
  let ws1: WorkspaceId; // Books enabled
  let ws2: WorkspaceId; // Books NOT enabled
  const createdEarningIds: DriveEarningId[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "drive-books-int@soletrade-test.local", fullName: "Drive Books Int" },
    ]);
    ws1 = await createWorkspace(actor, "Drive Books Int One", `drive-books-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Drive Books Int Two", `drive-books-two-${Date.now()}`);
    // Only ws1 has Books enabled - ws2 exercises the module-gate no-op.
    await enableModule(ws1, "books", actor);
    await enableModule(ws1, "drive", actor);
    await enableModule(ws2, "drive", actor);
    clearEventBus();
    unsub = registerBooksIntegration();
  });

  afterAll(async () => {
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    const tables: CleanupTable[] = [
      { table: "book_transactions" },
      { table: "drive_earnings" },
      { table: "audit_logs" },
      { table: "activity_events" },
      { table: "module_installations" },
    ];
    await cleanupWorkspaces(workspaceIds, [actor], tables);
  });

  /** Count Books income rows linked to a given earning in a workspace. */
  async function countIncomeForEarning(
    workspaceId: WorkspaceId,
    earningId: DriveEarningId,
  ): Promise<number> {
    const rows = await unwrap(
      getDataClient()
        .from("book_transactions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("source_earning_id", earningId),
    );
    return rows.length;
  }

  /** Fetch the (single) Books income row linked to an earning, or null. */
  async function getIncomeForEarning(workspaceId: WorkspaceId, earningId: DriveEarningId) {
    const row = await unwrapMaybe(
      getDataClient()
        .from("book_transactions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("source_earning_id", earningId)
        .limit(1)
        .maybeSingle(),
    );
    return row ? mapBookTx(row as Record<string, unknown>) : null;
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

  it("is idempotent - a replayed DriveEarningsLogged does not duplicate the income row", async () => {
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
    // Garbage metadata - no amountCents/currency/platform/date.
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

  // ───────────────── Wave 5: edit / delete sync ("Drive wins") ─────────────────

  it("updates the mirrored Books income row when a Drive earning is edited", async () => {
    const earningId = await createEarning(
      ws1!,
      {
        platform: "uber",
        amountCents: 30000,
        currency: "AUD",
        date: new Date("2026-07-10"),
        description: "Original earning",
      },
      actor,
    );
    createdEarningIds.push(earningId);

    let row = await getIncomeForEarning(ws1!, earningId);
    expect(row!.amountCents).toBe(30000);
    expect(row!.description).toBe("Drive earnings · Uber");

    await updateEarning(
      ws1!,
      earningId,
      { amountCents: 42500, description: "Revised earning", date: new Date("2026-07-11") },
      actor,
    );

    row = await getIncomeForEarning(ws1!, earningId);
    expect(row).not.toBeNull();
    expect(row!.amountCents).toBe(42500);
    expect(row!.description).toBe("Drive earnings · Uber");
    expect(row!.date.toISOString()).toBe(new Date("2026-07-11").toISOString());
    // Category + source link are preserved across the overwrite.
    expect(row!.category).toBe("gig");
    expect(row!.sourceEarningId).toBe(earningId);
  });

  it("overwrites a manually-edited Books row on a later Drive edit (Drive wins)", async () => {
    const earningId = await createEarning(
      ws1!,
      {
        platform: "uber",
        amountCents: 10000,
        currency: "AUD",
        date: new Date("2026-07-12"),
        description: "Manual base",
      },
      actor,
    );
    createdEarningIds.push(earningId);

    // Simulate the user editing the mirrored Books row directly in Books.
    await unwrapVoid(
      getDataClient()
        .from("book_transactions")
        .update({ amount_cents: 55555, description: "Manual edit" })
        .eq("source_earning_id", earningId),
    );

    // A later Drive edit overwrites the manual change ("Drive wins").
    await updateEarning(ws1!, earningId, { amountCents: 15000 }, actor);

    const row = await getIncomeForEarning(ws1!, earningId);
    expect(row!.amountCents).toBe(15000);
    expect(row!.description).toBe("Drive earnings · Uber");
  });

  it("deletes the mirrored Books income row when a Drive earning is deleted", async () => {
    const earningId = await createEarning(
      ws1!,
      {
        platform: "doordash",
        amountCents: 7000,
        currency: "AUD",
        date: new Date("2026-07-13"),
        description: "To delete",
      },
      actor,
    );
    createdEarningIds.push(earningId);
    expect(await countIncomeForEarning(ws1!, earningId)).toBe(1);

    const ok = await deleteEarning(ws1!, earningId, actor);
    expect(ok).toBe(true);

    // The Books row is removed - no orphaned mirror.
    expect(await countIncomeForEarning(ws1!, earningId)).toBe(0);
    // Remove from cleanup list - already gone.
    const idx = createdEarningIds.indexOf(earningId);
    if (idx >= 0) createdEarningIds.splice(idx, 1);
  });
});

/** Total book_transactions row count for a workspace (used by the missing-metadata test). */
async function dbRowCountForWorkspace(workspaceId: WorkspaceId): Promise<number> {
  const rows = await unwrap(
    getDataClient().from("book_transactions").select("id").eq("workspace_id", workspaceId),
  );
  return rows.length;
}
