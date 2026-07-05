import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/server/db";
import { subscriptions } from "@/server/db/schema";
import { getSubscription } from "@/platform/billing/subscriptions";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { disableModule, getInstalledModules } from "@/platform/module-installations";
import type { SubscriptionStatus } from "@/server/db/schema/enums";
import type { WorkspaceId } from "@/shared/types/ids";

/**
 * Webhook reconcile functions (brief §4). Maps Stripe events onto the local
 * `subscriptions` row + audit log, keeping our state in sync with Stripe as the
 * source of truth for the live subscription.
 *
 * Idempotency is layered:
 *   1. `handleStripeEvent` pre-checks `processed_webhook_events` (primary guard —
 *      `writeAudit` is append-only, so without this a retried event would
 *      duplicate the audit row).
 *   2. Each handler checks current state before writing (defense-in-depth).
 *
 * The pure mappers (`mapStripeStatusToLocal`, `mapCheckoutSessionToUpdate`) are
 * unit-tested with synthetic Stripe objects; the handlers are integration-tested
 * against local Supabase.
 */

/** Map a Stripe subscription status onto our `subscription_status` enum. */
export function mapStripeStatusToLocal(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "ended":
      return "canceled";
    case "incomplete":
    case "incomplete_expired":
      return "incomplete";
    case "trialing":
      // Treat trialing as active for our purposes (the customer has access).
      return "active";
    default:
      // Unknown status → safe default that surfaces in the UI as needing attention.
      return "incomplete";
  }
}

/** Map a completed Checkout Session onto the subscription row patch (Pro upgrade). */
export function mapCheckoutSessionToUpdate(
  session: Pick<Stripe.Checkout.Session, "customer" | "subscription">,
): {
  tier: "pro";
  status: "active";
  stripeCustomerId: string;
  stripeSubscriptionId: string;
} {
  return {
    tier: "pro",
    status: "active",
    stripeCustomerId: String(session.customer),
    stripeSubscriptionId: String(session.subscription),
  };
}

/**
 * `checkout.session.completed` (subscription mode): mark the workspace Pro + active
 * and store the Stripe customer/subscription ids. `anchorBillingDate` is set on
 * the first upgrade (preserved thereafter). Idempotent: skips if already
 * reconciled to this checkout's subscription.
 */
export async function reconcileFromCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const workspaceId = session.client_reference_id as WorkspaceId | null;
  if (!workspaceId) {
    console.error("[stripe] checkout.session.completed missing client_reference_id", {
      id: session.id,
    });
    return;
  }

  const current = await getSubscription(workspaceId);
  if (!current) throw new Error(`Subscription not found for workspace ${workspaceId}.`);

  // Idempotency: skip if already reconciled to this checkout's subscription.
  if (
    current.tier === "pro" &&
    current.status === "active" &&
    current.stripeSubscriptionId === String(session.subscription)
  ) {
    return;
  }

  const patch = mapCheckoutSessionToUpdate(session);
  const db = getDb();
  const rows = await db
    .update(subscriptions)
    .set({
      tier: patch.tier,
      status: patch.status,
      stripeCustomerId: patch.stripeCustomerId,
      stripeSubscriptionId: patch.stripeSubscriptionId,
      anchorBillingDate: current.anchorBillingDate ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.workspaceId, workspaceId))
    .returning({ id: subscriptions.id });
  const updated = rows[0];
  if (!updated) throw new Error(`Failed to update subscription for workspace ${workspaceId}.`);

  await publishEvent({
    type: "SubscriptionChanged",
    workspaceId,
    entityType: "subscription",
    entityId: updated.id,
    metadata: { from: current.tier, to: "pro" },
  });
  await writeAudit({
    workspaceId,
    action: "billing.subscription.update",
    targetType: "subscription",
    targetId: updated.id,
    metadata: { from: current.tier, to: "pro", source: "stripe.checkout.session.completed" },
  });
}

/**
 * `customer.subscription.updated`: sync the local status from Stripe. Idempotent:
 * skips if the status is unchanged.
 */
export async function reconcileSubscription(stripeSub: Stripe.Subscription): Promise<void> {
  const workspaceId = stripeSub.metadata?.workspaceId as WorkspaceId | undefined;
  if (!workspaceId) {
    console.error("[stripe] subscription.updated missing metadata.workspaceId", {
      id: stripeSub.id,
    });
    return;
  }
  const newStatus = mapStripeStatusToLocal(stripeSub.status);
  const current = await getSubscription(workspaceId);
  if (!current) return;
  if (current.status === newStatus) return; // idempotent: no-op on no change

  const db = getDb();
  await db
    .update(subscriptions)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(subscriptions.workspaceId, workspaceId));

  await writeAudit({
    workspaceId,
    action: "billing.subscription.update",
    targetType: "subscription",
    targetId: current.id,
    metadata: { from: current.status, to: newStatus, source: "stripe.subscription.updated" },
  });
}

/**
 * `customer.subscription.deleted`: downgrade to Free + canceled and cascade-disable
 * active modules (the Free-can't-have-modules invariant — their Stripe items are
 * gone with the subscription). Webhooks carry no user actor, so `disableModule` is
 * called with `undefined`. Idempotent: skips if already free + canceled.
 */
export async function markCanceled(stripeSub: Stripe.Subscription): Promise<void> {
  const workspaceId = stripeSub.metadata?.workspaceId as WorkspaceId | undefined;
  if (!workspaceId) {
    console.error("[stripe] subscription.deleted missing metadata.workspaceId", {
      id: stripeSub.id,
    });
    return;
  }
  const current = await getSubscription(workspaceId);
  if (!current) return;
  if (current.tier === "free" && current.status === "canceled") return; // idempotent

  const db = getDb();
  await db
    .update(subscriptions)
    .set({ tier: "free", status: "canceled", updatedAt: new Date() })
    .where(eq(subscriptions.workspaceId, workspaceId));

  // Maintain Free-can't-have-modules invariant: cascade-disable active modules.
  const active = await getInstalledModules(workspaceId);
  for (const key of active) {
    await disableModule(workspaceId, key, undefined); // webhook has no actor
  }

  await publishEvent({
    type: "SubscriptionChanged",
    workspaceId,
    entityType: "subscription",
    entityId: current.id,
    metadata: { from: current.tier, to: "free", reason: "stripe.subscription.deleted" },
  });
  await writeAudit({
    workspaceId,
    action: "billing.subscription.update",
    targetType: "subscription",
    targetId: current.id,
    metadata: { from: current.tier, to: "free", reason: "stripe.subscription.deleted" },
  });
}

/**
 * `invoice.paid`: audit-only in 4b. workspaceId is resolved by looking up the
 * `subscriptions` row matching `invoice.customer` (the Stripe customer id we store
 * on upgrade) — this Stripe API version no longer exposes `subscription_details` on
 * the top-level Invoice, so the customer id is the reliable join key. 4c will grant
 * credits on this event.
 */
export async function recordInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) return; // not all invoices carry a customer in 4b
  const db = getDb();
  const rows = await db
    .select({ workspaceId: subscriptions.workspaceId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  const row = rows[0];
  if (!row) return; // customer not known to us (e.g. test/legacy)
  await writeAudit({
    workspaceId: row.workspaceId,
    action: "billing.invoice.paid",
    targetType: "invoice",
    targetId: invoice.id,
    metadata: {
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      source: "stripe.invoice.paid",
    },
  });
}
