import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  subscriptions as subscriptionsTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus, onEvent } from "@/server/events";
import { changeTier, ensureSubscription, getSubscription } from "./subscriptions";

/**
 * Integration tests for the subscription service against a real Postgres.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Skipped when DATABASE_URL is unset. Creates its own user + workspaces and
 * cleans everything up in `afterAll`.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("subscription service integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000b2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  const collectedEvents: { type: string; from?: string; to?: string }[] = [];

  beforeAll(async () => {
    const db = getDb();
    clearEventBus();
    await db
      .insert(usersTable)
      .values({ id: actor, email: "sub-actor@soletrade-test.local", fullName: "Sub Actor" });
    ws1 = await createWorkspace(actor, "Sub Test One", `sub-test-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Sub Test Two", `sub-test-two-${Date.now()}`);
    onEvent("SubscriptionChanged", (e) => {
      collectedEvents.push({
        type: e.type,
        from: (e.metadata as { from?: string })?.from,
        to: (e.metadata as { to?: string })?.to,
      });
    });
  });

  afterAll(async () => {
    const db = getDb();
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) {
      await db.delete(usersTable).where(eq(usersTable.id, actor));
      return;
    }
    await db
      .delete(subscriptionsTable)
      .where(inArray(subscriptionsTable.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(eq(usersTable.id, actor));
    clearEventBus();
  });

  it("ensureSubscription creates a free-tier row and is idempotent", async () => {
    const first = await ensureSubscription(ws1!);
    expect(first.tier).toBe("free");
    expect(first.status).toBe("active");
    expect(first.stripeCustomerId).toBeNull();
    expect(first.anchorBillingDate).toBeNull();
    const second = await ensureSubscription(ws1!);
    expect(second.id).toBe(first.id); // same row, not a duplicate
    const direct = await getSubscription(ws1!);
    expect(direct?.id).toBe(first.id);
  });

  it("changeTier free→pro sets anchorBillingDate and emits SubscriptionChanged", async () => {
    const before = await getSubscription(ws1!);
    expect(before?.anchorBillingDate).toBeNull();
    const updated = await changeTier(ws1!, "pro", actor);
    expect(updated.tier).toBe("pro");
    expect(updated.anchorBillingDate).toBeInstanceOf(Date);
    const anchor = updated.anchorBillingDate!;
    // Event + audit recorded with from/to.
    expect(
      collectedEvents.some(
        (e) => e.type === "SubscriptionChanged" && e.from === "free" && e.to === "pro",
      ),
    ).toBe(true);
    const db = getDb();
    const auditRows = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, ws1!));
    expect(
      auditRows.some(
        (r) =>
          r.action === "billing.subscription.update" &&
          (r.metadata as { to?: string } | null)?.to === "pro",
      ),
    ).toBe(true);
    // Anchor is now set — a further change must PRESERVE it.
    const second = await changeTier(ws1!, "free", actor);
    expect(second.tier).toBe("free");
    expect(second.anchorBillingDate?.getTime()).toBe(anchor.getTime());
    const third = await changeTier(ws1!, "pro", actor);
    expect(third.anchorBillingDate?.getTime()).toBe(anchor.getTime());
  });

  it("changeTier is a no-op when the tier is unchanged", async () => {
    const before = await getSubscription(ws1!);
    const after = await changeTier(ws1!, before!.tier, actor);
    expect(after.tier).toBe(before!.tier);
    expect(after.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
  });

  it("isolates subscriptions per workspace (no IDOR)", async () => {
    // ws2 has no row yet — getSubscription returns null.
    expect(await getSubscription(ws2!)).toBeNull();
    // Provisioning ws2 must not affect ws1's row.
    const ws2Row = await ensureSubscription(ws2!);
    const ws1Row = await getSubscription(ws1!);
    expect(ws2Row.id).not.toBe(ws1Row!.id);
    expect(ws2Row.workspaceId).toBe(ws2!);
    expect(ws1Row!.workspaceId).toBe(ws1!);
  });

  it("throws when changing the tier of a workspace with no subscription", async () => {
    // Use a workspace that has no subscription row. ws2 now has one, so create a
    // fresh throwaway workspace and call changeTier before ensureSubscription.
    const ws3 = await createWorkspace(actor, "Sub Test Three", `sub-test-three-${Date.now()}`);
    await expect(changeTier(ws3, "pro", actor)).rejects.toThrow(/not found/i);
    // Cleanup ws3 only (it has a subscription row from... no it doesn't — changeTier
    // threw before inserting. But createWorkspace may have triggered the event
    // handler; clean defensively.)
    const db = getDb();
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.workspaceId, ws3));
    await db.delete(auditLogs).where(eq(auditLogs.workspaceId, ws3));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws3));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws3));
  });
});
