import type { SubscriptionRow } from "@/lib/domain/billing/subscriptions-types";
export type { SubscriptionRow } from "@/lib/domain/billing/subscriptions-types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { parsePgTimestamp, unwrapMaybe, unwrapVoid } from "@/server/infrastructure/db/helpers";
import type { BillingInterval } from "@/lib/domain/database-enums";
import { branded, type WorkspaceId } from "@/types/ids";

/**
 * Subscription service (brief §10 - one unified subscription per workspace).
 *
 * One row per workspace (`workspaceId` is unique). The row exists from workspace
 * creation onward with `billingInterval = null` (billing not started) and null Stripe
 * ids. `billingInterval` + the Stripe ids are populated when the workspace starts
 * billing via Stripe Checkout (Phase 4b lifecycle). `anchorBillingDate` is set on the
 * FIRST start-billing and never touched again - the anchor billing date is preserved
 * across later module/anchor changes.
 *
 * The local row is the cache of Stripe's truth; webhooks reconcile it. Money math lives
 * in the pure pricing engine (`@/platform/billing/pricing`); this service only stores
 * state + publishes events + audits.
 */

const SUBSCRIPTION_COLUMNS =
  "id, workspace_id, billing_interval, status, stripe_customer_id, stripe_subscription_id, anchor_billing_date, created_at, updated_at";

/** Maps a snake_case PostgREST subscriptions row to the camelCase `SubscriptionRow`. */
function toSubscriptionRow(r: {
  id: string;
  workspace_id: string;
  billing_interval: BillingInterval | null;
  status: SubscriptionRow["status"];
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  anchor_billing_date: string | null;
  created_at: string;
  updated_at: string;
}): SubscriptionRow {
  return {
    id: branded<"SubscriptionId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    billingInterval: r.billing_interval,
    status: r.status,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    anchorBillingDate: r.anchor_billing_date ? parsePgTimestamp(r.anchor_billing_date) : null,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/** The workspace's 1:1 subscription row, or null if none exists yet. */
export async function getSubscription(workspaceId: WorkspaceId): Promise<SubscriptionRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("subscriptions")
      .select(SUBSCRIPTION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toSubscriptionRow(row) : null;
}

/**
 * Idempotently create an unbilled subscription row for a workspace if none exists.
 * Called by the WorkspaceCreated event handler (in instrumentation) and lazily by the
 * billing loader. Safe to call repeatedly - always returns the row.
 */
export async function ensureSubscription(workspaceId: WorkspaceId): Promise<SubscriptionRow> {
  const supabase = getDataClient();
  // onConflictDoNothing → upsert with ignoreDuplicates so a pre-existing row is left
  // untouched (no partial-overwrite of the populated Stripe columns on a lazy re-call).
  // Wrapped in unwrapVoid so a PostgREST error throws (supabase-js returns, never throws).
  await unwrapVoid(
    supabase
      .from("subscriptions")
      .upsert(
        { workspace_id: workspaceId, billing_interval: null, status: "active" },
        { onConflict: "workspace_id", ignoreDuplicates: true },
      ),
  );
  // Re-read so we always return the canonical row (whether inserted or pre-existing).
  const row = await getSubscription(workspaceId);
  if (!row) throw new Error(`ensureSubscription failed for workspace ${workspaceId}.`);
  return row;
}

/**
 * Flip the workspace's `billingInterval` (monthly↔annual). Used by the 4c interval-switch
 * orchestrator AFTER the Stripe-side reprice (`switchSubscriptionInterval`) succeeds, so
 * the local column always reflects the prices Stripe is now billing. The `anchorBillingDate`
 * is preserved - switching interval does not reset the anchor.
 */
export async function setBillingInterval(
  workspaceId: WorkspaceId,
  interval: BillingInterval,
): Promise<void> {
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("subscriptions")
      .update({ billing_interval: interval, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId),
  );
}
