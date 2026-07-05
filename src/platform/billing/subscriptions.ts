import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { subscriptions } from "@/server/db/schema";
import type { PlanTier } from "@/server/db/schema/enums";
import type { SubscriptionId, UserId, WorkspaceId } from "@/shared/types/ids";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";

/**
 * Subscription service (brief §4 — one unified subscription per workspace).
 *
 * One row per workspace (`workspaceId` is unique). The row exists from workspace
 * creation onward at the `free` tier; `stripeCustomerId`/`stripeSubscriptionId`
 * stay null until 4b. `anchorBillingDate` is set on the FIRST upgrade to Pro and
 * never touched again — the anchor billing date is preserved across later
 * plan/module changes.
 *
 * 4a is local-only: `changeTier` mutates the row without calling Stripe. It is
 * NOT exposed as a server action here (no free-upgrade loophole — real upgrades
 * require Stripe in 4b). It exists for the integration test and as the seam 4b
 * will wrap with Stripe customer/subscription creation.
 */

export interface SubscriptionRow {
  id: SubscriptionId;
  workspaceId: WorkspaceId;
  tier: PlanTier;
  status: "active" | "past_due" | "canceled" | "incomplete";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  anchorBillingDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectRow = {
  id: subscriptions.id,
  workspaceId: subscriptions.workspaceId,
  tier: subscriptions.tier,
  status: subscriptions.status,
  stripeCustomerId: subscriptions.stripeCustomerId,
  stripeSubscriptionId: subscriptions.stripeSubscriptionId,
  anchorBillingDate: subscriptions.anchorBillingDate,
  createdAt: subscriptions.createdAt,
  updatedAt: subscriptions.updatedAt,
} as const;

/** The workspace's 1:1 subscription row, or null if none exists yet. */
export async function getSubscription(workspaceId: WorkspaceId): Promise<SubscriptionRow | null> {
  const db = getDb();
  const rows = await db
    .select(selectRow)
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Idempotently create a free-tier subscription for a workspace if none exists.
 * Called by the WorkspaceCreated event handler (in instrumentation) and lazily
 * by the billing loader. Safe to call repeatedly — always returns the row.
 */
export async function ensureSubscription(workspaceId: WorkspaceId): Promise<SubscriptionRow> {
  const db = getDb();
  await db
    .insert(subscriptions)
    .values({ workspaceId, tier: "free", status: "active" })
    .onConflictDoNothing({ target: subscriptions.workspaceId });
  // Re-read so we always return the canonical row (whether inserted or pre-existing).
  const row = await getSubscription(workspaceId);
  if (!row) throw new Error(`ensureSubscription failed for workspace ${workspaceId}.`);
  return row;
}

/**
 * Change the workspace's plan tier locally (no Stripe call). Sets
 * `anchorBillingDate = now()` ONLY when upgrading to Pro AND the anchor is
 * currently null — the anchor is preserved on every subsequent change.
 *
 * 4a: internal/test-only. 4b will wrap this in the Stripe customer + unified
 * subscription creation flow.
 */
export async function changeTier(
  workspaceId: WorkspaceId,
  tier: PlanTier,
  actorUserId?: UserId,
): Promise<SubscriptionRow> {
  const db = getDb();
  const current = await getSubscription(workspaceId);
  if (!current) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (current.tier === tier) return current;

  const set: Partial<{ tier: PlanTier; anchorBillingDate: Date; updatedAt: Date }> = {
    tier,
    updatedAt: new Date(),
  };
  if (tier === "pro" && current.anchorBillingDate == null) {
    set.anchorBillingDate = new Date();
  }

  const rows = await db
    .update(subscriptions)
    .set(set)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .returning(selectRow);
  const updated = rows[0];
  if (!updated) throw new Error(`Failed to update subscription for workspace ${workspaceId}.`);

  await publishEvent({
    type: "SubscriptionChanged",
    workspaceId,
    actorUserId,
    entityType: "subscription",
    entityId: updated.id,
    metadata: { from: current.tier, to: tier },
  });
  await writeAudit({
    workspaceId,
    actorUserId,
    action: "billing.subscription.update",
    targetType: "subscription",
    targetId: updated.id,
    metadata: { from: current.tier, to: tier },
  });
  return updated;
}
