import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus } from "@/server/events";
import { ensureSubscription, getSubscription } from "./subscriptions";

/**
 * Integration tests for the subscription service against a real Postgres.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Skipped when DATABASE_URL is unset. Creates its own user + workspaces and
 * cleans everything up in `afterAll`. (The old `changeTier` path was removed in
 * the pricing rework — tier/anchor mutations now flow through the webhook reconcile
 * layer, tested in handlers.integration.test.ts.)
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("subscription service integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000b2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;

  beforeAll(async () => {
    clearEventBus();
    await seedUsers([{ id: actor, email: "sub-actor@soletrade-test.local", fullName: "Sub Actor" }]);
    ws1 = await createWorkspace(actor, "Sub Test One", `sub-test-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Sub Test Two", `sub-test-two-${Date.now()}`);
  });

  afterAll(async () => {
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    // The helper deletes users even when workspaceIds is empty, covering the
    // original no-workspace branch that deleted only the user.
    await cleanupWorkspaces(
      workspaceIds,
      [actor],
      [{ table: "subscriptions" }, { table: "audit_logs" }],
    );
    clearEventBus();
  });

  it("ensureSubscription creates an unbilled row (billingInterval null, null Stripe ids) and is idempotent", async () => {
    const first = await ensureSubscription(ws1!);
    expect(first.billingInterval).toBeNull();
    expect(first.status).toBe("active");
    expect(first.stripeCustomerId).toBeNull();
    expect(first.stripeSubscriptionId).toBeNull();
    expect(first.anchorBillingDate).toBeNull();
    const second = await ensureSubscription(ws1!);
    expect(second.id).toBe(first.id); // same row, not a duplicate
    const direct = await getSubscription(ws1!);
    expect(direct?.id).toBe(first.id);
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
    // ws2 row starts unbilled too.
    expect(ws2Row.billingInterval).toBeNull();
    expect(ws2Row.stripeSubscriptionId).toBeNull();
  });
});
