import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { subscriptions } from "@/server/db/schema";
import type { BillingInterval } from "@/server/db/schema/enums";
import type { SubscriptionId, WorkspaceId } from "@/shared/types/ids";

/**
 * Subscription service (brief §10 — one unified subscription per workspace).
 *
 * One row per workspace (`workspaceId` is unique). The row exists from workspace
 * creation onward with `billingInterval = null` (billing not started) and null Stripe
 * ids. `billingInterval` + the Stripe ids are populated when the workspace starts
 * billing via Stripe Checkout (Phase 4b lifecycle). `anchorBillingDate` is set on the
 * FIRST start-billing and never touched again — the anchor billing date is preserved
 * across later module/anchor changes.
 *
 * The local row is the cache of Stripe's truth; webhooks reconcile it. Money math lives
 * in the pure pricing engine (`@/platform/billing/pricing`); this service only stores
 * state + publishes events + audits.
 */

export interface SubscriptionRow {
  id: SubscriptionId;
  workspaceId: WorkspaceId;
  billingInterval: BillingInterval | null;
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
  billingInterval: subscriptions.billingInterval,
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
 * Idempotently create an unbilled subscription row for a workspace if none exists.
 * Called by the WorkspaceCreated event handler (in instrumentation) and lazily by the
 * billing loader. Safe to call repeatedly — always returns the row.
 */
export async function ensureSubscription(workspaceId: WorkspaceId): Promise<SubscriptionRow> {
  const db = getDb();
  await db
    .insert(subscriptions)
    .values({ workspaceId, billingInterval: null, status: "active" })
    .onConflictDoNothing({ target: subscriptions.workspaceId });
  // Re-read so we always return the canonical row (whether inserted or pre-existing).
  const row = await getSubscription(workspaceId);
  if (!row) throw new Error(`ensureSubscription failed for workspace ${workspaceId}.`);
  return row;
}

/**
 * Flip the workspace's `billingInterval` (monthly↔annual). Used by the 4c interval-switch
 * orchestrator AFTER the Stripe-side reprice (`switchSubscriptionInterval`) succeeds, so
 * the local column always reflects the prices Stripe is now billing. The `anchorBillingDate`
 * is preserved — switching interval does not reset the anchor.
 */
export async function setBillingInterval(
  workspaceId: WorkspaceId,
  interval: BillingInterval,
): Promise<void> {
  const db = getDb();
  await db
    .update(subscriptions)
    .set({ billingInterval: interval, updatedAt: new Date() })
    .where(eq(subscriptions.workspaceId, workspaceId));
}
