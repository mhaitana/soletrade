import "server-only";
import {
  addModuleSubscriptionItem,
  removeModuleSubscriptionItem,
  cancelSubscription,
  switchSubscriptionInterval,
  BillingNotStartedError,
} from "@/server/stripe/stripe-lifecycle";
import { enableModule, disableModule, getInstalledModules } from "@/platform/module-installations";
import { getSubscription, setBillingInterval } from "@/platform/billing/subscriptions";
import { refundCredit } from "@/platform/billing/credits";
import { moduleRefundCents } from "@/platform/billing/pricing";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import type { BillingInterval } from "@/server/db/schema/enums";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
import type { ModuleKey } from "@/shared/constants/modules";

/**
 * Billing module orchestrator (brief §10). Wraps the Stripe lifecycle service with the
 * local module-installations state + audit/events, so server actions have a single
 * seam to add/remove a module from the unified subscription.
 *
 * Anchor-aware repricing: `addModuleSubscriptionItem`/`removeModuleSubscriptionItem`
 * handle the Stripe-side repricing when the anchor changes (demote old anchor to
 * add-on, or promote the next-highest module to standalone). This orchestrator records
 * the outcome in the audit log.
 */

export interface AddModuleResult {
  stripeSubscriptionItemId: string;
  role: "standalone" | "addon";
  becameAnchor: boolean;
  demotedItemId?: string;
}

/**
 * Add a module to the workspace's unified subscription: create the Stripe subscription
 * item (with anchor-aware repricing), upsert the local installation row (storing the
 * item id), and audit. Throws `BillingNotStartedError` for a workspace without active
 * billing.
 */
export async function addModuleToSubscription(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
  actorId: UserId,
): Promise<AddModuleResult> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);

  const { itemId, role, becameAnchor, demotedItemId } = await addModuleSubscriptionItem(
    workspaceId,
    moduleKey,
  );

  await enableModule(workspaceId, moduleKey, actorId, itemId);

  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "billing.subscription.item.add",
    targetType: "module",
    targetId: moduleKey,
    metadata: { moduleKey, role, becameAnchor, demotedItemId, stripeSubscriptionItemId: itemId },
  });

  return { stripeSubscriptionItemId: itemId, role, becameAnchor, demotedItemId };
}

export interface RemoveModuleResult {
  deletedItemId: string | null;
  promotedItemId?: string;
  promotedModuleKey?: ModuleKey;
  /** Cents refunded to the credit ledger (0 when no active billing / nothing to refund). */
  refundCents: number;
}

/**
 * Remove a module from the unified subscription: delete the Stripe subscription item
 * (promoting a new anchor if the removed module was the anchor), disable the local
 * installation row, and issue a pro-rated credit refund for the unused portion of the
 * current billing period (4c). Permissive on billing state: a canceled/unbilled workspace
 * disabling a stray module still works locally (the lifecycle returns null for legacy
 * rows and the refund is skipped when billing state is missing).
 *
 * The active set is captured BEFORE the disable so `moduleRefundCents` can resolve the
 * role (anchor vs add-on) the module held this cycle. The refund is only issued when the
 * workspace has active billing (`stripeSubscriptionId` + `billingInterval` +
 * `anchorBillingDate` all present); legacy/unbilled rows get `refundCents: 0`.
 */
export async function removeModuleFromSubscription(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
  actorId?: UserId,
): Promise<RemoveModuleResult> {
  const sub = await getSubscription(workspaceId);
  // Capture the active set BEFORE the disable so the refund can resolve the role.
  const active = await getInstalledModules(workspaceId);

  const { deletedItemId, promotedItemId, promotedModuleKey } = await removeModuleSubscriptionItem(
    workspaceId,
    moduleKey,
  );

  await disableModule(workspaceId, moduleKey, actorId);

  // Pro-rated refund for the unused portion of the current billing period.
  let refundCents = 0;
  if (sub?.stripeSubscriptionId && sub?.billingInterval && sub?.anchorBillingDate) {
    refundCents = moduleRefundCents(
      moduleKey,
      active,
      sub.billingInterval,
      sub.anchorBillingDate,
      new Date(),
    );
    if (refundCents > 0) {
      await refundCredit(
        workspaceId,
        {
          amountCents: refundCents,
          currency: "AUD",
          reason: "module.cancel.refund",
          moduleKey,
          actorUserId: actorId,
          metadata: {
            interval: sub.billingInterval,
            anchorBillingDate: sub.anchorBillingDate.toISOString(),
            deletedItemId,
            promotedItemId,
            promotedModuleKey,
          },
        },
        actorId,
      );
    }
  }

  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "billing.subscription.item.remove",
    targetType: "module",
    targetId: moduleKey,
    metadata: {
      moduleKey,
      deletedItemId,
      promotedItemId,
      promotedModuleKey,
      refundCents,
    },
  });

  return { deletedItemId, promotedItemId, promotedModuleKey, refundCents };
}

/**
 * Switch the workspace's billing interval (monthly↔annual). Effective next cycle — Stripe
 * items are repriced with `proration_behavior: "none"` (no immediate charge/credit), and
 * the local `billingInterval` is flipped to match. The 4c ledger does NOT true-up the
 * switch (consistent with the established no-proration stance); the next `invoice.paid`
 * grants at the new prices. Throws `BillingNotStartedError` (bubbled from the Stripe
 * lifecycle) if there is no active subscription.
 */
export async function switchBillingInterval(
  workspaceId: WorkspaceId,
  interval: BillingInterval,
  actorId: UserId,
): Promise<void> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  const from = sub.billingInterval;
  if (from === interval) return; // no-op: same interval requested

  await switchSubscriptionInterval(workspaceId, interval);
  await setBillingInterval(workspaceId, interval);

  const active = await getInstalledModules(workspaceId);
  await publishEvent({
    type: "SubscriptionChanged",
    workspaceId,
    entityType: "subscription",
    entityId: sub.id,
    metadata: { from: from ?? "unbilled", to: interval, moduleKeys: active, switch: true },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "billing.subscription.interval.switch",
    targetType: "subscription",
    targetId: sub.id,
    metadata: { from: from ?? "unbilled", to: interval, moduleKeys: active },
  });
}

export { BillingNotStartedError, cancelSubscription };
