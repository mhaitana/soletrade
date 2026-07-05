import "server-only";
import {
  addModuleSubscriptionItem,
  removeModuleSubscriptionItem,
  UpgradeRequiredError,
} from "@/server/stripe/stripe-lifecycle";
import { enableModule, disableModule, getInstalledModules } from "@/platform/module-installations";
import { getSubscription } from "@/platform/billing/subscriptions";
import { writeAudit } from "@/platform/audit";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
import type { ModuleKey } from "@/shared/constants/modules";

/**
 * Billing module orchestrator (brief §4). Wraps the Stripe lifecycle service with
 * the local module-installations state + audit/events, so server actions have a
 * single seam to add/remove a module from the unified subscription.
 *
 * The stack discount is frozen at enable time: `addModuleToSubscription` computes
 * `position = currentActiveModuleCount` and `addModuleSubscriptionItem` creates
 * the Stripe subscription item with that position's Price. The Price is immutable
 * on the item, so removing other modules does not reprice surviving items.
 */

/**
 * Add a module to the workspace's unified subscription: create the Stripe
 * subscription item, upsert the local installation row (storing the item id),
 * and audit. Throws `UpgradeRequiredError` for a Free workspace.
 */
export async function addModuleToSubscription(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
  actorId: UserId,
): Promise<{ stripeSubscriptionItemId: string; position: number }> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (sub.tier !== "pro") throw new UpgradeRequiredError();

  const position = (await getInstalledModules(workspaceId)).length;
  const stripeSubscriptionItemId = await addModuleSubscriptionItem(workspaceId, moduleKey);

  await enableModule(workspaceId, moduleKey, actorId, stripeSubscriptionItemId);

  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "billing.subscription.item.add",
    targetType: "module",
    targetId: moduleKey,
    metadata: { moduleKey, position, stripeSubscriptionItemId },
  });

  return { stripeSubscriptionItemId, position };
}

/**
 * Remove a module from the unified subscription: delete the Stripe subscription
 * item (proration_behavior:none — the 4c credit engine handles refunds) and
 * disable the local installation row. Permissive on tier: a Free workspace
 * disabling a stray legacy module still works locally.
 */
export async function removeModuleFromSubscription(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
  actorId?: UserId,
): Promise<{ stripeSubscriptionItemId: string | null }> {
  const stripeSubscriptionItemId = await removeModuleSubscriptionItem(workspaceId, moduleKey);

  await disableModule(workspaceId, moduleKey, actorId);

  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "billing.subscription.item.remove",
    targetType: "module",
    targetId: moduleKey,
    metadata: { moduleKey, stripeSubscriptionItemId },
  });

  return { stripeSubscriptionItemId };
}

export { UpgradeRequiredError };
