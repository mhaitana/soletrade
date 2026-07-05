import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { subscriptions, moduleInstallations } from "@/server/db/schema";
import { getSubscription, ensureSubscription } from "@/platform/billing/subscriptions";
import { getInstalledModules } from "@/platform/module-installations";
import { getStripe } from "./client";
import { getProAnchorPriceId, getModulePriceId } from "./prices";
import type { WorkspaceId } from "@/shared/types/ids";
import type { ModuleKey } from "@/shared/constants/modules";

/**
 * Stripe lifecycle service (brief §4 — one customer + one unified subscription
 * per workspace; modules are subscription items).
 *
 * 4b wires the live flows:
 *   - Pro upgrade via Stripe Checkout (hosted redirect — no client SDK).
 *   - Module enable/disable add/remove a subscription item on the unified sub.
 *
 * The stack discount is **frozen at module-enable time**: each module's
 * subscription item is created with the Price for its position and keeps that
 * Price for its lifetime (Stripe Prices on subscription items are immutable).
 * Removing other modules does NOT reprice surviving items; re-enabling a module
 * computes a fresh position from the current active count.
 */

/** Thrown when a Free workspace tries to add a module (must upgrade first). */
export class UpgradeRequiredError extends Error {
  constructor(message = "Upgrade to Pro to enable modules.") {
    super(message);
    this.name = "UpgradeRequiredError";
  }
}

/**
 * Return the workspace's Stripe customer id, creating the Stripe customer if
 * none exists yet. Idempotent: a second call returns the stored id. Stores the id
 * on the `subscriptions` row for later reconciliation.
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
 * Create a Stripe Checkout Session for upgrading to Pro (subscription mode,
 * anchor item only — modules are added afterward via the unified subscription).
 * Returns the hosted Checkout `url` for the browser to redirect to.
 *
 * `subscription_data.metadata.workspaceId` is set so `customer.subscription.*`
 * webhooks can reconcile back to the workspace, and Stripe snapshots it into
 * `invoice.subscription_details.metadata` for `invoice.paid`.
 */
export async function createProCheckoutSession(
  workspaceId: WorkspaceId,
  opts: { email?: string | null; successUrl: string; cancelUrl: string },
): Promise<{ url: string; sessionId: string }> {
  await ensureSubscription(workspaceId);
  // Resolve the anchor price id before any Stripe I/O so a misconfigured env
  // surfaces as an actionable error rather than a cryptic Stripe API failure.
  const anchorPriceId = getProAnchorPriceId();
  const customerId = await ensureStripeCustomer(workspaceId, { email: opts.email });
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: anchorPriceId, quantity: 1 }],
    client_reference_id: String(workspaceId),
    subscription_data: { metadata: { workspaceId: String(workspaceId) } },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });

  if (!session.url) {
    throw new Error(`Stripe Checkout Session ${session.id} did not return a url.`);
  }
  return { url: session.url, sessionId: session.id };
}

/**
 * Add a module subscription item to the workspace's unified subscription.
 * `position = getInstalledModules(workspaceId).length` (the next 0-indexed slot)
 * selects the Price, freezing the stack discount at enable time.
 *
 * Throws `UpgradeRequiredError` for a Free workspace, and a clear error for a
 * legacy 4a-seeded Pro workspace whose `stripeSubscriptionId` is null.
 */
export async function addModuleSubscriptionItem(
  workspaceId: WorkspaceId,
  moduleKey: ModuleKey,
): Promise<string> {
  const sub = await getSubscription(workspaceId);
  if (!sub) throw new Error(`Subscription not found for workspace ${workspaceId}.`);
  if (sub.tier !== "pro") throw new UpgradeRequiredError();
  if (!sub.stripeSubscriptionId) {
    throw new Error(
      `Pro subscription is missing a Stripe subscription id for workspace ${workspaceId}. Re-upgrade via Stripe Checkout to attach a live subscription.`,
    );
  }

  const position = (await getInstalledModules(workspaceId)).length;
  const priceId = getModulePriceId(position);
  const stripe = getStripe();

  const item = await stripe.subscriptionItems.create({
    subscription: sub.stripeSubscriptionId,
    price: priceId,
    quantity: 1,
    metadata: {
      workspaceId: String(workspaceId),
      moduleKey,
      position: String(position),
    },
  });

  return item.id;
}

/**
 * Remove a module's subscription item from Stripe. Returns the deleted item id, or
 * `null` if the module_installations row has no stored `stripeSubscriptionItemId`
 * (a legacy pre-4b module or one enabled without a Stripe item). The local
 * `module_installations` row retains the (now-deleted) item id per the brief.
 *
 * `proration_behavior: "none"` honors the LOCKED decision: no Stripe-side proration
 * on remove. The 4c credit engine grants refund credits for the unused portion.
 */
export async function removeModuleSubscriptionItem(
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
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.itemId) return null;

  const stripe = getStripe();
  await stripe.subscriptionItems.del(row.itemId, { proration_behavior: "none" });
  return row.itemId;
}
