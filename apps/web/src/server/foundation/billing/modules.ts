import type { AddModuleResult, RemoveModuleResult } from "@/lib/domain/billing/modules-types";
export type { AddModuleResult, RemoveModuleResult } from "@/lib/domain/billing/modules-types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrap } from "@/server/infrastructure/db/helpers";
import {
  assertStripeAuthority,
  changeStripeModule,
  getBillingAuthority,
  isStoreAuthority,
} from "@/server/foundation/billing/authority";
import {
  addModuleSubscriptionItem,
  removeModuleSubscriptionItem,
  cancelSubscription,
  switchSubscriptionInterval,
  refundToCard,
  BillingNotStartedError,
} from "@/server/foundation/billing/stripe/stripe-lifecycle";
import {
  getInstalledModules,
  scheduleModuleCancellation,
  listPendingCancellationsDue,
} from "@/server/foundation/module-installations";
import { getSubscription, setBillingInterval } from "@/server/foundation/billing/subscriptions";
import { refundCredit } from "@/server/foundation/billing/credits";
import {
  moduleRefundCents,
  moduleChargeCents,
  currentBillingPeriod,
  type Interval,
} from "@/lib/domain/billing/pricing";
import type { CancelOption } from "@/lib/domain/billing/cancellation";
import { publishEvent } from "@/server/infrastructure/events";
import { writeAudit } from "@/server/foundation/audit";
import type { BillingInterval } from "@/lib/domain/database-enums";
import type { UserId, WorkspaceId } from "@/types/ids";
import type { ModuleKey } from "@/config/modules";

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
  await assertStripeAuthority(workspaceId);
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

  await changeStripeModule(workspaceId, sub.stripeSubscriptionId!, moduleKey, true, itemId);
  await moduleEvent(workspaceId, moduleKey, true, actorId);

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

/**
 * Resolve the period-end timestamp for a keep-until-end cancellation, given the
 * workspace's billing state. Null when there's no active billing (the no-billing
 * fallback uses `now` as the effective time - disable immediately).
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
 *     the installation row and do NOT disable or touch Stripe - the module stays
 *     active/billable until the `module-cancel-finalize` cron finalizes it at period
 *     end. `refundCents` is 0 (access runs to term).
 *   - `immediate_credit` (Branch A, default): delete the Stripe item (promoting a new
 *     anchor if needed), disable the local row, and issue a pro-rated **credit ledger**
 *     refund. The pre-Wave-1 behavior.
 *   - `immediate_refund` (Branch A or B): delete the Stripe item, disable the local row,
 *     and issue a pro-rated **card refund** via `refundToCard` (no ledger entry).
 *
 * Permissive on billing state: a canceled/unbilled workspace disabling a stray module
 * still works locally - keep-until-end with no billing degrades to an immediate disable
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
  await assertStripeAuthority(workspaceId);
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
  if (sub?.stripeSubscriptionId)
    await changeStripeModule(workspaceId, sub.stripeSubscriptionId, moduleKey, false);
  else {
    // Legacy unbilled cleanup only touches unowned installations; a store projection
    // concurrently claiming the row makes this predicate match nothing.
    if (await getBillingAuthority(workspaceId))
      throw new Error("Billing authority changed. Refresh before changing modules.");
    await unwrap(
      getDataClient()
        .from("module_installations")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", workspaceId)
        .eq("module_key", moduleKey)
        .is("billing_contract_id", null)
        .select("id"),
    );
  }
  await moduleEvent(workspaceId, moduleKey, false, actorId);

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
 * Switch the workspace's billing interval (monthly↔annual). Effective next cycle - Stripe
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
  await assertStripeAuthority(workspaceId);
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
 * fired when the cancellation was booked). Idempotent - `disableModule` flips the row
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
      if (isStoreAuthority(await getBillingAuthority(row.workspaceId))) continue;
      const sub = await getSubscription(row.workspaceId);
      if (!sub?.stripeSubscriptionId) continue;
      await removeModuleSubscriptionItem(row.workspaceId, row.moduleKey);
      await changeStripeModule(row.workspaceId, sub.stripeSubscriptionId, row.moduleKey, false);
      await moduleEvent(row.workspaceId, row.moduleKey, false);
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

async function moduleEvent(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
  enabled: boolean,
  actorId?: UserId,
) {
  await publishEvent({
    type: enabled ? "ModuleEnabled" : "ModuleDisabled",
    workspaceId,
    actorUserId: actorId,
    entityType: "module",
    entityId: moduleKey,
    metadata: { moduleKey },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: enabled ? "module.enable" : "module.disable",
    targetType: "module",
    targetId: moduleKey,
    metadata: { moduleKey },
  });
}
