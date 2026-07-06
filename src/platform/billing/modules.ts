import "server-only";
import {
  addModuleSubscriptionItem,
  removeModuleSubscriptionItem,
  cancelSubscription,
  switchSubscriptionInterval,
  refundToCard,
  BillingNotStartedError,
} from "@/server/stripe/stripe-lifecycle";
import {
  enableModule,
  disableModule,
  getInstalledModules,
  scheduleModuleCancellation,
  listPendingCancellationsDue,
} from "@/platform/module-installations";
import { getSubscription, setBillingInterval } from "@/platform/billing/subscriptions";
import { refundCredit } from "@/platform/billing/credits";
import {
  moduleRefundCents,
  moduleChargeCents,
  currentBillingPeriod,
  type Interval,
} from "@/platform/billing/pricing";
import type { CancelOption } from "@/platform/billing/cancellation";
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

  // Compute the mid-cycle proration charge preview (§10.5) from the active set
  // BEFORE the add, so the audit records what was actually charged. `now` is fixed
  // once for consistency between the preview and the Stripe call.
  const now = new Date();
  const activeBefore = await getInstalledModules(workspaceId);
  const proration =
    sub.billingInterval && sub.anchorBillingDate
      ? moduleChargeCents(moduleKey, activeBefore, sub.billingInterval, sub.anchorBillingDate, now)
      : { proratedCents: 0, netCents: 0, role: "addon" as const, becomesAnchor: false };

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
    metadata: {
      moduleKey,
      role,
      becameAnchor,
      demotedItemId,
      stripeSubscriptionItemId: itemId,
      proratedChargeCents: proration.proratedCents,
      netCents: proration.netCents,
    },
  });

  return { stripeSubscriptionItemId: itemId, role, becameAnchor, demotedItemId };
}

export interface RemoveModuleResult {
  deletedItemId: string | null;
  promotedItemId?: string;
  promotedModuleKey?: ModuleKey;
  /** Cents moved by the cancellation (ledger credit or card refund; 0 for keep / no billing). */
  refundCents: number;
  /** Which cancellation option was executed. */
  option: CancelOption;
  /** Stripe refund id when a card refund was issued, else null. */
  stripeRefundId: string | null;
  /** Effective timestamp for keep-until-end (the period end); null otherwise. */
  effectiveAt: Date | null;
}

/**
 * Resolve the period-end timestamp for a keep-until-end cancellation, given the
 * workspace's billing state. Null when there's no active billing (the no-billing
 * fallback uses `now` as the effective time — disable immediately).
 */
function periodEndFor(
  interval: Interval | null,
  anchorBillingDate: Date | null,
  now: Date,
): Date | null {
  if (!interval || !anchorBillingDate) return null;
  return currentBillingPeriod(anchorBillingDate, interval, now).end;
}

/**
 * Remove a module from the unified subscription per the spec's cancellation engine
 * (brief §10.6). The `option` controls the execution path:
 *
 *   - `keep_until_end_of_cycle` (Branch A): set `pendingCancellationAt = periodEnd` on
 *     the installation row and do NOT disable or touch Stripe — the module stays
 *     active/billable until the `module-cancel-finalize` cron finalizes it at period
 *     end. `refundCents` is 0 (access runs to term).
 *   - `immediate_credit` (Branch A, default): delete the Stripe item (promoting a new
 *     anchor if needed), disable the local row, and issue a pro-rated **credit ledger**
 *     refund. The pre-Wave-1 behavior.
 *   - `immediate_refund` (Branch A or B): delete the Stripe item, disable the local row,
 *     and issue a pro-rated **card refund** via `refundToCard` (no ledger entry).
 *
 * Permissive on billing state: a canceled/unbilled workspace disabling a stray module
 * still works locally — keep-until-end with no billing degrades to an immediate disable
 * (effectiveAt = now, refund 0), and the immediate paths skip the refund when billing
 * state is missing. The active set is captured BEFORE the disable so `moduleRefundCents`
 * can resolve the role the module held this cycle.
 */
export async function removeModuleFromSubscription(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
  actorId: UserId | undefined,
  option: CancelOption = "immediate_credit",
): Promise<RemoveModuleResult> {
  const sub = await getSubscription(workspaceId);
  const now = new Date();
  // Capture the active set BEFORE the disable so the refund can resolve the role.
  const active = await getInstalledModules(workspaceId);
  const hasBilling =
    !!sub?.stripeSubscriptionId && !!sub?.billingInterval && !!sub?.anchorBillingDate;
  const refundCents = hasBilling
    ? moduleRefundCents(moduleKey, active, sub!.billingInterval!, sub!.anchorBillingDate!, now)
    : 0;

  // Keep-until-end: schedule and stop here (no disable, no Stripe).
  if (option === "keep_until_end_of_cycle") {
    const periodEnd = periodEndFor(
      sub?.billingInterval ?? null,
      sub?.anchorBillingDate ?? null,
      now,
    );
    // No active billing → degrade to an immediate disable (nothing to keep until).
    if (!periodEnd) {
      return removeModuleFromSubscription(workspaceId, moduleKey, actorId, "immediate_credit");
    }
    await scheduleModuleCancellation(workspaceId, moduleKey, periodEnd, actorId);
    await writeAudit({
      workspaceId,
      actorUserId: actorId,
      action: "billing.subscription.item.remove",
      targetType: "module",
      targetId: moduleKey,
      metadata: { moduleKey, option, effectiveAt: periodEnd.toISOString() },
    });
    return {
      deletedItemId: null,
      refundCents: 0,
      option,
      stripeRefundId: null,
      effectiveAt: periodEnd,
    };
  }

  const { deletedItemId, promotedItemId, promotedModuleKey } = await removeModuleSubscriptionItem(
    workspaceId,
    moduleKey,
  );
  await disableModule(workspaceId, moduleKey, actorId);

  let stripeRefundId: string | null = null;
  if (option === "immediate_credit") {
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
            interval: sub!.billingInterval!,
            anchorBillingDate: sub!.anchorBillingDate!.toISOString(),
            deletedItemId,
            promotedItemId,
            promotedModuleKey,
          },
        },
        actorId,
      );
    }
  } else if (option === "immediate_refund") {
    // Card refund via Stripe (no ledger entry). Best-effort: refundToCard returns null
    // when there's no charge to refund against; we still complete the cancellation.
    if (refundCents > 0) {
      stripeRefundId = await refundToCard(workspaceId, refundCents).catch((err) => {
        console.error("[billing] card refund failed:", err);
        return null;
      });
      if (stripeRefundId) {
        await publishEvent({
          type: "RefundIssued",
          workspaceId,
          actorUserId: actorId,
          entityType: "module",
          entityId: moduleKey,
          metadata: { method: "card", amountCents: refundCents, moduleKey, stripeRefundId },
        });
      }
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
      option,
      deletedItemId,
      promotedItemId,
      promotedModuleKey,
      refundCents,
      stripeRefundId,
    },
  });

  return {
    deletedItemId,
    promotedItemId,
    promotedModuleKey,
    refundCents,
    option,
    stripeRefundId,
    effectiveAt: null,
  };
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

/**
 * Finalize module cancellations whose keep-until-end timestamp has lapsed (brief §10.6
 * Branch A "keep-until-end"). For each due row: delete the Stripe subscription item
 * (promoting a new anchor if the removed module was the anchor), disable the local
 * row, and publish `ModuleDisabled` (the scheduled `ModuleCancelled` event already
 * fired when the cancellation was booked). Idempotent — `disableModule` flips the row
 * to `cancelled` so a second run won't re-pick it. Returns the count finalized.
 *
 * Called by the `module-cancel-finalize` cron runner. Per-row try/catch keeps one
 * failing row from aborting the batch.
 */
export async function finalizeModuleCancellations(now: Date = new Date()): Promise<number> {
  const due = await listPendingCancellationsDue(now);
  let count = 0;
  for (const row of due) {
    try {
      await removeModuleSubscriptionItem(row.workspaceId, row.moduleKey);
      await disableModule(row.workspaceId, row.moduleKey);
      await writeAudit({
        workspaceId: row.workspaceId,
        action: "module.cancel.finalized",
        targetType: "module",
        targetId: row.moduleKey,
        metadata: { moduleKey: row.moduleKey, finalizedAt: now.toISOString() },
      });
      count++;
    } catch (err) {
      console.error("[billing] finalizeModuleCancellations failed for", row, err);
    }
  }
  return count;
}

export { BillingNotStartedError, cancelSubscription };
