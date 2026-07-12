import "server-only";
import { getAdminDb } from "./db";
import { getStripe } from "@/server/stripe/client";
import { getSubscription } from "@/platform/billing/subscriptions";
import { mapStripeStatusToLocal } from "@/platform/billing/reconcile";
import { buildPriceIdToModuleMap } from "@/server/stripe/prices";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";
import type { BillingInterval } from "@/server/db/enums";
import { branded } from "@/shared/types/ids";

export interface AdminSubscriptionSummary {
  workspaceId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string;
  billingInterval: BillingInterval | null;
  anchorModuleKey: string | null;
  addonModuleKeys: string[];
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export async function listWorkspaceSubscriptions(): Promise<AdminSubscriptionSummary[]> {
  await requireAdminContext("view:subscriptions");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("subscriptions")
    .select(
      "workspace_id, stripe_customer_id, stripe_subscription_id, status, billing_interval, anchor_module_key, addon_module_keys, current_period_end, cancel_at_period_end",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (!rows) return [];

  return (
    rows as Array<{
      workspace_id: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      status: string;
      billing_interval: BillingInterval | null;
      anchor_module_key: string | null;
      addon_module_keys: string[] | null;
      current_period_end: string | null;
      cancel_at_period_end: boolean | null;
    }>
  ).map((row) => ({
    workspaceId: row.workspace_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    billingInterval: row.billing_interval,
    anchorModuleKey: row.anchor_module_key,
    addonModuleKeys: row.addon_module_keys ?? [],
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  }));
}

/** Map a Stripe recurring interval ("month" | "year") onto our `billing_interval` enum
 *  ("monthly" | "annual"). Returns null for unknown/absent intervals. */
function mapStripeInterval(interval: string | undefined | null): BillingInterval | null {
  if (interval === "month") return "monthly";
  if (interval === "year") return "annual";
  return null;
}

/**
 * Refetch the workspace's Stripe subscription and resync the local `subscriptions` cache
 * (status, billing interval, current period end, cancel-at-period-end, anchor + add-on
 * module keys). The local row is a cache of Stripe's truth; webhooks normally keep it in
 * sync — this action lets an admin force a refresh without opening the Stripe dashboard.
 * Audit-logged with `source: "admin.manual_reconcile"`.
 */
export async function reconcileSubscriptionMetadata(
  workspaceId: string,
  reason: string,
): Promise<void> {
  const ctx = await requireAdminContext("manage:subscriptions");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A reason is required to reconcile subscription state.");
  }

  const wsId = branded<"WorkspaceId">(workspaceId);
  const current = await getSubscription(wsId);
  if (!current || !current.stripeSubscriptionId) {
    throw new Error("No Stripe subscription is linked to this workspace.");
  }

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(current.stripeSubscriptionId, {
    expand: ["items.data.price"],
  });

  const newStatus = mapStripeStatusToLocal(sub.status);
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);

  // This Stripe API version moved `current_period_end` off the top-level Subscription
  // onto each subscription item; read it from the first item.
  const firstItem = sub.items.data[0];
  const currentPeriodEnd = firstItem?.current_period_end
    ? new Date(firstItem.current_period_end * 1000).toISOString()
    : null;

  // Derive the billing interval + module breakdown from the recurring item prices.
  let billingInterval: BillingInterval | null = null;
  let anchorModuleKey: string | null = null;
  const addonModuleKeys: string[] = [];
  const priceMap = buildPriceIdToModuleMap();
  for (const item of sub.items.data) {
    const priceId = typeof item.price === "string" ? item.price : item.price?.id;
    if (!priceId) continue;
    if (!billingInterval) {
      const recurring =
        typeof item.price === "string" ? undefined : item.price?.recurring?.interval;
      billingInterval = mapStripeInterval(recurring);
    }
    const mapping = priceMap.get(priceId);
    if (!mapping) continue; // unrelated price - skip defensively
    if (anchorModuleKey === null) anchorModuleKey = mapping.moduleKey;
    else if (!addonModuleKeys.includes(mapping.moduleKey)) addonModuleKeys.push(mapping.moduleKey);
  }

  const nowIso = new Date().toISOString();
  const db = getAdminDb();
  await db
    .from("subscriptions")
    .update({
      status: newStatus,
      billing_interval: billingInterval,
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      anchor_module_key: anchorModuleKey,
      addon_module_keys: addonModuleKeys,
      updated_at: nowIso,
    })
    .eq("workspace_id", workspaceId);

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "billing_admin",
    action: "reconcile_subscription",
    targetType: "subscription",
    targetId: workspaceId,
    workspaceId,
    reason,
    metadata: {
      from: current.status,
      to: newStatus,
      stripeSubscriptionId: current.stripeSubscriptionId,
      billingInterval,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      anchorModuleKey,
      addonModuleKeys,
      source: "admin.manual_reconcile",
    },
  });
}
