import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db";
import { subscriptions, moduleInstallations } from "@/server/db/schema";
import { getSubscription, ensureSubscription } from "@/platform/billing/subscriptions";
import { getInstalledModules } from "@/platform/module-installations";
import { selectAnchor, MODULE_PRICES, type Interval } from "@/platform/billing/pricing";
import { getStripe } from "./client";
import { getModulePriceId, priceSlot } from "./prices";
import type { ModuleKey } from "@/shared/constants/modules";
import type { WorkspaceId } from "@/shared/types/ids";

/**
 * Stripe lifecycle service (brief §10 — one customer + one unified subscription per
 * workspace; modules are subscription items; the highest-standalone active module is
 * the anchor, billed at its standalone price; the rest are add-ons).
 *
 * Anchor-aware repricing: when the anchor changes, surviving items are repriced via
 * `stripe.subscriptionItems.update({ price, proration_behavior: "none" })` so the
 * invariant "the highest active module always pays its standalone price" holds. This
 * supersedes the earlier "frozen at enable time" decision (made under the old tier
 * model). Stripe issues no ad-hoc proration credits; the 4c credit ledger reconciles
 * true-ups.
 */

/** Thrown when a workspace without active billing tries to add a module. */
export class BillingNotStartedError extends Error {
  constructor(message = "Start billing to enable modules.") {
    super(message);
    this.name = "BillingNotStartedError";
  }
}

/** Read the workspace's active module_installations row's stored Stripe item id. */
async function getStoredItemId(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ itemId: moduleInstallations.stripeSubscriptionItemId })
    .from(moduleInstallations)
    .where(
      and(
        eq(moduleInstallations.workspaceId, workspaceId),
        eq(moduleInstallations.moduleKey, moduleKey),
        isNull(moduleInstallations.cancelledAt),
      ),
    )
    .limit(1);
  return rows[0]?.itemId ?? null;
}

/**
 * Return the workspace's Stripe customer id, creating the Stripe customer if none
 * exists yet. Idempotent: a second call returns the stored id. Stores the id on the
 * `subscriptions` row for later reconciliation.
 */
export async function ensureStripeCustomer(
  workspaceId: WorkspaceId,
  opts: { email?: string | null },
): Promise<string> {
  const current = await getSubscription(workspaceId);
  if (!current) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (current.stripeCustomerId) return current.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: opts.email ?? undefined,
    metadata: { workspaceId: String(workspaceId) },
  });

  const db = getDb();
  await db
    .update(subscriptions)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(subscriptions.workspaceId, workspaceId));

  return customer.id;
}

/**
 * Create a Stripe Checkout Session to start billing with a chosen set of modules at a
 * chosen interval. The highest-standalone module is the anchor (billed standalone);
 * the rest are add-ons. `subscription_data.metadata` carries `workspaceId` + `interval`
 * so the `checkout.session.completed` webhook can reconcile. Returns the hosted Checkout
 * `url` for the browser to redirect to.
 *
 * Price ids are resolved BEFORE any Stripe I/O so a misconfigured env surfaces as an
 * actionable error rather than a cryptic Stripe API failure.
 */
export async function createCheckoutSession(
  workspaceId: WorkspaceId,
  opts: {
    moduleKeys: ModuleKey[];
    interval: Interval;
    email?: string | null;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ url: string; sessionId: string }> {
  if (opts.moduleKeys.length === 0) {
    throw new Error("Cannot start billing with no modules selected.");
  }
  await ensureSubscription(workspaceId);
  // Resolve price ids before any Stripe I/O (fail-fast on misconfigured env).
  const anchor = selectAnchor(opts.moduleKeys);
  if (!anchor) throw new Error("Failed to select an anchor module.");
  const lineItems = opts.moduleKeys.map((key) => ({
    price:
      key === anchor
        ? getModulePriceId(key, "standalone", opts.interval)
        : getModulePriceId(key, "addon", opts.interval),
    quantity: 1,
  }));
  const customerId = await ensureStripeCustomer(workspaceId, { email: opts.email });
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    client_reference_id: String(workspaceId),
    subscription_data: {
      metadata: { workspaceId: String(workspaceId), interval: opts.interval },
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });

  if (!session.url) {
    throw new Error(`Stripe Checkout Session ${session.id} did not return a url.`);
  }
  return { url: session.url, sessionId: session.id };
}

export interface AddItemResult {
  itemId: string;
  /** The role the new module is billed as. */
  role: "standalone" | "addon";
  /** True when the new module became the anchor (demoting the previous anchor). */
  becameAnchor: boolean;
  /** The previous anchor's item id, when it was demoted to add-on. */
  demotedItemId?: string;
}

/**
 * Add a module to the workspace's unified subscription with anchor-aware repricing:
 *  - If the new module's standalone price exceeds the current anchor's, it becomes the
 *    new anchor (created at standalone) AND the old anchor's item is demoted to add-on.
 *  - Otherwise the new module is an add-on (created at the add-on price).
 *
 * Throws `BillingNotStartedError` if the workspace has no active Stripe subscription.
 */
export async function addModuleSubscriptionItem(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
): Promise<AddItemResult> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (!sub.stripeSubscriptionId || sub.status !== "active") {
    throw new BillingNotStartedError();
  }
  const interval = sub.billingInterval;
  if (!interval) throw new BillingNotStartedError();

  const active = await getInstalledModules(workspaceId);
  const currentAnchor = selectAnchor(active); // null only if no active modules (mid-billing shouldn't happen)
  const newStandaloneMonthly = MODULE_PRICES[moduleKey].standalone.monthly;
  const becomesAnchor =
    currentAnchor === null ||
    newStandaloneMonthly > MODULE_PRICES[currentAnchor].standalone.monthly;

  const role = becomesAnchor ? "standalone" : "addon";
  const priceId = getModulePriceId(moduleKey, role, interval);
  const stripe = getStripe();

  const item = await stripe.subscriptionItems.create({
    subscription: sub.stripeSubscriptionId,
    price: priceId,
    quantity: 1,
    metadata: {
      workspaceId: String(workspaceId),
      moduleKey,
      role,
      interval,
      slot: priceSlot(moduleKey, role, interval),
    },
  });

  let demotedItemId: string | undefined;
  if (becameAnchorAsDemote(becomesAnchor, currentAnchor)) {
    // Demote the previous anchor to add-on (price decrease → no proration credit).
    const oldItemId = await getStoredItemId(workspaceId, currentAnchor);
    if (oldItemId) {
      const demotePriceId = getModulePriceId(currentAnchor, "addon", interval);
      await stripe.subscriptionItems.update(oldItemId, {
        price: demotePriceId,
        proration_behavior: "none",
        metadata: {
          workspaceId: String(workspaceId),
          moduleKey: currentAnchor,
          role: "addon",
          interval,
          slot: priceSlot(currentAnchor, "addon", interval),
        },
      });
      demotedItemId = oldItemId;
    }
  }

  return { itemId: item.id, role, becameAnchor: becomesAnchor, demotedItemId };
}

/** Helper: demote only when the new module becomes anchor AND there was a previous anchor. */
function becameAnchorAsDemote(
  becomesAnchor: boolean,
  currentAnchor: ModuleKey | null,
): currentAnchor is ModuleKey {
  return becomesAnchor && currentAnchor !== null;
}

export interface RemoveItemResult {
  deletedItemId: string | null;
  /** The promoted anchor's item id, when the removed module was the anchor and a new
   * anchor was promoted from add-on → standalone. */
  promotedItemId?: string;
  /** The module key promoted to anchor, if any. */
  promotedModuleKey?: ModuleKey;
}

/**
 * Remove a module's subscription item from Stripe. If the removed module was the
 * anchor, the next-highest active module is promoted: its item is repriced from
 * add-on → standalone (`proration_behavior: "none"`). Returns the deleted item id (or
 * null for a legacy row with no stored item) plus the promoted anchor, if any.
 */
export async function removeModuleSubscriptionItem(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
): Promise<RemoveItemResult> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  const interval = sub.billingInterval;

  const itemId = await getStoredItemId(workspaceId, moduleKey);
  if (!itemId || !interval || !sub.stripeSubscriptionId) {
    return { deletedItemId: itemId ?? null };
  }

  const active = await getInstalledModules(workspaceId); // still includes moduleKey (disableModule runs after)
  const wasAnchor = selectAnchor(active) === moduleKey;

  const stripe = getStripe();
  await stripe.subscriptionItems.del(itemId, { proration_behavior: "none" });

  if (!wasAnchor) return { deletedItemId: itemId };

  // Promote the next-highest active module to anchor (add-on → standalone).
  const remaining = active.filter((k) => k !== moduleKey);
  const newAnchor = selectAnchor(remaining);
  if (!newAnchor) return { deletedItemId: itemId };

  const promotedItemId = await getStoredItemId(workspaceId, newAnchor);
  if (!promotedItemId) return { deletedItemId: itemId };

  const promotePriceId = getModulePriceId(newAnchor, "standalone", interval);
  await stripe.subscriptionItems.update(promotedItemId, {
    price: promotePriceId,
    proration_behavior: "none",
    metadata: {
      workspaceId: String(workspaceId),
      moduleKey: newAnchor,
      role: "standalone",
      interval,
      slot: priceSlot(newAnchor, "standalone", interval),
    },
  });

  return { deletedItemId: itemId, promotedItemId, promotedModuleKey: newAnchor };
}

/**
 * Cancel the workspace's Stripe subscription (user-initiated). Immediate cancel with no
 * Stripe proration — our credit ledger issues the per-module prorated refunds when the
 * `customer.subscription.deleted` webhook fires (`markCanceled`). Does NOT touch local
 * state; the webhook reconciles (status → canceled, billingInterval → null, modules
 * cascade-disabled, refunds issued). Throws `BillingNotStartedError` if there is no
 * active subscription to cancel.
 */
export async function cancelSubscription(workspaceId: WorkspaceId): Promise<void> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (!sub.stripeSubscriptionId || sub.status !== "active") {
    throw new BillingNotStartedError();
  }
  const stripe = getStripe();
  await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
}

/**
 * Switch the workspace's billing interval (monthly↔annual). Reprices every active
 * subscription item to the new interval's price id with `proration_behavior: "none"`
 * (effective next cycle — no immediate Stripe charge/credit; the 4c ledger does not
 * true-up the switch), then updates the subscription metadata so future webhooks read
 * the new interval. The anchor stays the same (the active set is unchanged); each item
 * keeps its role (anchor → standalone[newInterval], others → addon[newInterval]).
 *
 * Throws `BillingNotStartedError` if there is no active subscription. The local
 * `billingInterval` column is flipped by the orchestrator (via `setBillingInterval`),
 * not here — this function only does the Stripe-side reprice + metadata update.
 */
export async function switchSubscriptionInterval(
  workspaceId: WorkspaceId,
  interval: Interval,
): Promise<void> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (!sub.stripeSubscriptionId || sub.status !== "active") {
    throw new BillingNotStartedError();
  }
  const active = await getInstalledModules(workspaceId);
  const anchor = selectAnchor(active);
  const stripe = getStripe();

  for (const key of active) {
    const itemId = await getStoredItemId(workspaceId, key);
    if (!itemId) continue; // legacy row with no stored item — skip
    const role = key === anchor ? "standalone" : "addon";
    const priceId = getModulePriceId(key, role, interval);
    await stripe.subscriptionItems.update(itemId, {
      price: priceId,
      proration_behavior: "none",
      metadata: {
        workspaceId: String(workspaceId),
        moduleKey: key,
        role,
        interval,
        slot: priceSlot(key, role, interval),
      },
    });
  }

  // Update the subscription metadata so future webhooks read the new interval (Stripe
  // merges metadata keys; workspaceId is preserved).
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    proration_behavior: "none",
    metadata: { workspaceId: String(workspaceId), interval },
  });
}
