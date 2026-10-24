import "server-only";
import {
  assertStripeAuthority,
  getBillingAuthority,
  recordStripeCheckoutSession,
  reserveStripeCheckout,
  releaseStripeCheckout,
} from "@/platform/billing/authority";
import { getDataClient } from "@/server/db/client";
import { unwrapMaybe, unwrapVoid } from "@/server/db/helpers";
import { getSubscription, ensureSubscription } from "@/platform/billing/subscriptions";
import { getInstalledModules } from "@/platform/module-installations";
import { selectAnchor, MODULE_PRICES, type Interval } from "@/platform/billing/pricing";
import { getStripe } from "./client";
import { getModulePriceId, priceSlot } from "./prices";
import type { ModuleKey } from "@/shared/constants/modules";
import type { WorkspaceId } from "@/shared/types/ids";
import type { CheckoutPromotion } from "@/platform/billing/promotions";

/**
 * Stripe lifecycle service (brief §10 - one customer + one unified subscription per
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
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("module_installations")
      .select("stripe_subscription_item_id")
      .eq("workspace_id", workspaceId)
      .eq("module_key", moduleKey)
      .is("cancelled_at", null)
      .limit(1)
      .maybeSingle(),
  );
  return row?.stripe_subscription_item_id ?? null;
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
  await assertStripeAuthority(workspaceId, undefined, { allowExpiredStore: true });
  const current = await getSubscription(workspaceId);
  if (!current) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (current.stripeCustomerId) return current.stripeCustomerId;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: opts.email ?? undefined,
    metadata: { workspaceId: String(workspaceId) },
  });

  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("subscriptions")
      .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId),
  );

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
    allowPromotionCodes?: boolean;
    promotion?: CheckoutPromotion;
  },
): Promise<{ url: string; sessionId: string }> {
  await assertStripeAuthority(workspaceId, undefined, { allowExpiredStore: true });
  if (opts.moduleKeys.length === 0) {
    throw new Error("Cannot start billing with no modules selected.");
  }
  const current = await ensureSubscription(workspaceId);
  if (current.stripeSubscriptionId && ["active", "past_due"].includes(current.status))
    throw new Error(
      "This workspace already has active web billing. Manage the existing subscription.",
    );
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

  // Stripe forbids combining a pre-applied discount with the manual promotion-code
  // field. A linked promotion wins; otherwise Checkout still offers code entry.
  const promotionParams = opts.promotion
    ? { discounts: [{ promotion_code: opts.promotion.stripePromotionCodeId }] }
    : { allow_promotion_codes: opts.allowPromotionCodes ?? false };

  const { reservationId, expiresAt } = await reserveStripeCheckout(workspaceId);
  try {
    const session = await stripe.checkout.sessions.create(
      {
        expires_at: expiresAt,
        integration_identifier: `soletrade-web-${reservationId.replaceAll("-", "").slice(0, 8).replace(/[0-9]/g, "a")}`,
        mode: "subscription",
        customer: customerId,
        line_items: lineItems,
        client_reference_id: String(workspaceId),
        ...promotionParams,
        metadata: { reservationId, ...(opts.promotion ? { promotionId: opts.promotion.id } : {}) },
        subscription_data: {
          metadata: {
            workspaceId: String(workspaceId),
            interval: opts.interval,
            reservationId,
            ...(opts.promotion ? { promotionId: opts.promotion.id } : {}),
          },
        },
        success_url: opts.successUrl,
        cancel_url: opts.cancelUrl,
      },
      { idempotencyKey: `checkout:${reservationId}` },
    );

    await recordStripeCheckoutSession(workspaceId, reservationId, session.id);
    if (!session.url) {
      throw new Error(`Stripe Checkout Session ${session.id} did not return a url.`);
    }
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    // A transport timeout may have created a payable session. Keep that reservation until
    // expiry; definitive Stripe request/auth failures created no session and can release it.
    const kind = error && typeof error === "object" && "type" in error ? String(error.type) : "";
    if (
      ["StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError"].includes(
        kind,
      )
    )
      await releaseStripeCheckout(workspaceId, reservationId);
    throw error;
  }
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
  await assertStripeAuthority(workspaceId);
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  await assertStripeAuthority(workspaceId, sub.stripeSubscriptionId);
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
    // §10.5: charge the mid-cycle proration immediately (next-invoice by default).
    proration_behavior: "always_invoice",
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
  await assertStripeAuthority(workspaceId);
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  await assertStripeAuthority(workspaceId, sub.stripeSubscriptionId);
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
 * Cancel option for the cancel-all path (brief §10.6 Branch B). Stored on the Stripe
 * subscription's `metadata.cancelOption` so the `customer.subscription.deleted` webhook
 * (`markCanceled`) knows whether to issue per-module credit refunds.
 *   - `keep_until_end` → `cancel_at_period_end: true`; webhook fires at period end with
 *     no refunds (access already ran to term).
 *   - `immediate_refund` → cancel now; the card was already refunded `refundCents` via
 *     `refundToCard` before this call; webhook issues NO ledger refund.
 *   - `immediate_credit` → cancel now; no card refund; webhook issues per-module credit
 *     refunds (the legacy/automatic path, retained for backward-compat).
 */
export type CancelSubscriptionOption = "keep_until_end" | "immediate_credit" | "immediate_refund";

export interface CancelSubscriptionResult {
  /** Stripe refund id when a card refund was issued, else null. */
  stripeRefundId: string | null;
}

/**
 * Refund `amountCents` to the workspace's original payment method (the latest paid,
 * not-fully-refunded charge on the Stripe customer). Returns the Stripe refund id, or
 * null when there is nothing to refund (amount ≤ 0, no customer, or no eligible charge).
 * Best-effort: a missing charge surfaces as null rather than throwing so the caller can
 * still proceed with the cancellation. Brief §10.6 "immediate refund" path.
 *
 * Uses `stripe.charges.list` (newest-first) rather than the invoice's `charge` field -
 * this Stripe API version no longer exposes `charge` on the Invoice resource, and the
 * latest charge is the reliable refund target anyway.
 */
export async function refundToCard(
  workspaceId: WorkspaceId,
  amountCents: number,
): Promise<string | null> {
  await assertStripeAuthority(workspaceId);
  if (amountCents <= 0) return null;
  const sub = await getSubscription(workspaceId);
  if (!sub || !sub.stripeCustomerId) return null;
  await assertStripeAuthority(workspaceId, sub.stripeSubscriptionId);
  const stripe = getStripe();
  const charges = await stripe.charges.list({ customer: sub.stripeCustomerId, limit: 10 });
  // First paid charge with enough remaining balance to cover the refund.
  const charge = charges.data.find(
    (c) => c.paid && !c.refunded && c.amount - c.amount_refunded >= amountCents,
  );
  if (!charge) return null;
  const refund = await stripe.refunds.create({ charge: charge.id, amount: amountCents });
  return refund.id;
}

/**
 * Cancel the workspace's Stripe subscription (user-initiated, Branch B offboarding).
 * `manage:billing` only. Three options (brief §10.6):
 *   - `keep_until_end` → `cancel_at_period_end: true` + `metadata.cancelOption`; access
 *     continues to period end, the webhook fires then with no refunds.
 *   - `immediate_refund` → refund `refundCents` to the card first, then cancel with
 *     `metadata.cancelOption = "immediate_refund"`; webhook issues NO ledger refund.
 *   - `immediate_credit` (default, legacy) → cancel now with no card refund; the
 *     `customer.subscription.deleted` webhook (`markCanceled`) issues per-module
 *     prorated credit refunds (the pre-Wave-1 behavior).
 *
 * Does NOT touch local state; the webhook reconciles (status → canceled, modules
 * cascade-disabled, refunds issued per the option). Throws `BillingNotStartedError` if
 * there is no active subscription to cancel.
 */
export async function cancelSubscription(
  workspaceId: WorkspaceId,
  option: CancelSubscriptionOption = "immediate_credit",
  refundCents = 0,
): Promise<CancelSubscriptionResult> {
  await assertStripeAuthority(workspaceId);
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  await assertStripeAuthority(workspaceId, sub.stripeSubscriptionId);
  if (!sub.stripeSubscriptionId || sub.status !== "active") {
    throw new BillingNotStartedError();
  }
  const stripe = getStripe();

  if (option === "keep_until_end") {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
      metadata: { cancelOption: "keep_until_end" },
    });
    return { stripeRefundId: null };
  }

  // Immediate path: refund the card first (if requested), then cancel.
  let stripeRefundId: string | null = null;
  if (option === "immediate_refund") {
    stripeRefundId = await refundToCard(workspaceId, refundCents);
    // Stamp the cancelOption so the webhook knows a card refund already issued.
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      metadata: { cancelOption: "immediate_refund" },
    });
  }
  // immediate_credit: cancel with no metadata → webhook sees cancelOption undefined
  // and issues per-module credit refunds (legacy behavior). Immediate cancel is the
  // default (no Stripe proration); `subscriptions.cancel` takes no proration_behavior.
  await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
  return { stripeRefundId };
}

/**
 * Switch the workspace's billing interval (monthly↔annual). Reprices every active
 * subscription item to the new interval's price id with `proration_behavior: "none"`
 * (effective next cycle - no immediate Stripe charge/credit; the 4c ledger does not
 * true-up the switch), then updates the subscription metadata so future webhooks read
 * the new interval. The anchor stays the same (the active set is unchanged); each item
 * keeps its role (anchor → standalone[newInterval], others → addon[newInterval]).
 *
 * Throws `BillingNotStartedError` if there is no active subscription. The local
 * `billingInterval` column is flipped by the orchestrator (via `setBillingInterval`),
 * not here - this function only does the Stripe-side reprice + metadata update.
 */
export async function switchSubscriptionInterval(
  workspaceId: WorkspaceId,
  interval: Interval,
): Promise<void> {
  await assertStripeAuthority(workspaceId);
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  await assertStripeAuthority(workspaceId, sub.stripeSubscriptionId);
  if (!sub.stripeSubscriptionId || sub.status !== "active") {
    throw new BillingNotStartedError();
  }
  const active = await getInstalledModules(workspaceId);
  const anchor = selectAnchor(active);
  const stripe = getStripe();

  for (const key of active) {
    const itemId = await getStoredItemId(workspaceId, key);
    if (!itemId) continue; // legacy row with no stored item - skip
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

/** Expire the payable session before freeing its authority; a completed purchase must reconcile. */
export async function cancelPendingCheckout(workspaceId: WorkspaceId): Promise<void> {
  const current = await getBillingAuthority(workspaceId);
  if (
    !current ||
    current.provider !== "stripe" ||
    current.status !== "incomplete" ||
    !current.external_id.startsWith("checkout:")
  )
    throw new Error("No pending web checkout was found.");
  const reservationId = current.external_id.slice("checkout:".length);
  if (current.paid_through && new Date(current.paid_through).getTime() <= Date.now()) {
    await releaseStripeCheckout(workspaceId, reservationId);
    return;
  }
  if (!current.product_key.startsWith("cs_"))
    throw new Error("Checkout is still being prepared. Try again shortly.");
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(current.product_key);
  if (
    session.client_reference_id !== workspaceId ||
    session.metadata?.reservationId !== reservationId
  )
    throw new Error("Checkout does not match this workspace reservation.");
  if (session.status === "complete" || session.subscription)
    throw new Error("Checkout completed. Refresh billing while the purchase reconciles.");
  if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
  else if (session.status !== "expired")
    throw new Error("Checkout status is not yet settled. Try again shortly.");
  await releaseStripeCheckout(workspaceId, reservationId);
}
