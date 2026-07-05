import "server-only";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/server/db";
import { creditLedger, subscriptions } from "@/server/db/schema";
import { getSubscription } from "@/platform/billing/subscriptions";
import { enableModule, disableModule, getInstalledModules } from "@/platform/module-installations";
import { grantCredit, refundCredit } from "@/platform/billing/credits";
import { priceSubscription, prorateRefundCents } from "@/platform/billing/pricing";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import type { SubscriptionStatus, BillingInterval } from "@/server/db/schema/enums";
import type { ModuleKey } from "@/shared/constants/modules";
import type { Role } from "@/platform/billing/pricing";
import type { WorkspaceId } from "@/shared/types/ids";

/**
 * Webhook reconcile functions (brief §10). Maps Stripe events onto the local
 * `subscriptions` row + audit log + module_installations state, keeping our state in
 * sync with Stripe as the source of truth for the live subscription.
 *
 * Idempotency is layered:
 *   1. `handleStripeEvent` pre-checks `processed_webhook_events` (primary guard —
 *      `writeAudit` is append-only, so without this a retried event would duplicate the
 *      audit row).
 *   2. Each handler checks current state before writing (defense-in-depth).
 *
 * Stripe I/O (subscription retrieval, price-id → module mapping) lives in the webhook
 * handler (`@/server/stripe/handlers`); this module owns the DB writes only.
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

/** A subscription item resolved to a module + role, for the checkout reconcile. */
export interface CheckoutItem {
  moduleKey: ModuleKey;
  role: Role;
  itemId: string;
}

/** Patch derived from a completed Checkout Session (ids only — interval + items come
 * from the subscription retrieval done by the handler). */
export function mapCheckoutSessionToUpdate(
  session: Pick<Stripe.Checkout.Session, "customer" | "subscription">,
): {
  status: "active";
  stripeCustomerId: string;
  stripeSubscriptionId: string;
} {
  return {
    status: "active",
    stripeCustomerId: String(session.customer),
    stripeSubscriptionId: String(session.subscription),
  };
}

/**
 * `checkout.session.completed` (subscription mode): mark the workspace active + billing
 * at `interval`, store the Stripe customer/subscription ids, and enable each chosen
 * module locally with its subscription item id. `anchorBillingDate` is set on the first
 * start-billing (preserved thereafter). Idempotent: skips if already reconciled to this
 * checkout's subscription.
 */
export async function reconcileFromCheckoutSession(
  session: Stripe.Checkout.Session,
  payload: { interval: BillingInterval; items: CheckoutItem[] },
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

  // Idempotency: skip if already reconciled to this checkout's subscription + interval.
  if (
    current.stripeSubscriptionId === String(session.subscription) &&
    current.billingInterval === payload.interval &&
    current.status === "active"
  ) {
    return;
  }

  const patch = mapCheckoutSessionToUpdate(session);
  const db = getDb();
  const rows = await db
    .update(subscriptions)
    .set({
      billingInterval: payload.interval,
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

  // Enable each chosen module locally with its subscription item id (actorless webhook upsert).
  for (const item of payload.items) {
    await enableModule(workspaceId, item.moduleKey, undefined, item.itemId);
  }

  await publishEvent({
    type: "SubscriptionChanged",
    workspaceId,
    entityType: "subscription",
    entityId: updated.id,
    metadata: {
      from: current.billingInterval ?? "unbilled",
      to: payload.interval,
      moduleKeys: payload.items.map((i) => i.moduleKey),
    },
  });
  await writeAudit({
    workspaceId,
    action: "billing.subscription.update",
    targetType: "subscription",
    targetId: updated.id,
    metadata: {
      from: current.billingInterval ?? "unbilled",
      to: payload.interval,
      moduleKeys: payload.items.map((i) => i.moduleKey),
      source: "stripe.checkout.session.completed",
    },
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
 * `customer.subscription.deleted`: issue a pro-rated refund for each active module
 * (4c — same formula as a single-module cancel), then mark canceled + clear billing
 * interval and cascade-disable active modules (their Stripe items are gone with the
 * subscription). The `stripeSubscriptionId` is retained for the audit trail. Webhooks
 * carry no user actor, so `disableModule`/`refundCredit` are called with `undefined`.
 * Idempotent: skips if already canceled with no billing interval.
 *
 * Refunds are computed BEFORE the row update clears `billingInterval`/`anchorBillingDate`
 * (they're needed for the proration). Legacy rows missing either are skipped (no refund),
 * consistent with the single-module cancel path.
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
  if (current.status === "canceled" && current.billingInterval === null) return; // idempotent

  const now = new Date();
  const refundedModuleKeys: ModuleKey[] = [];
  // Per-module prorated refund (actorless — webhook). Only when we have the billing state
  // needed to compute the period; legacy rows missing interval/anchor get no refund.
  if (current.billingInterval && current.anchorBillingDate) {
    const active = await getInstalledModules(workspaceId);
    const breakdown = priceSubscription(active, current.billingInterval);
    for (const m of breakdown.modules) {
      const refundCents = prorateRefundCents(
        m.netCents,
        current.billingInterval,
        current.anchorBillingDate,
        now,
      );
      if (refundCents > 0) {
        await refundCredit(
          workspaceId,
          {
            amountCents: refundCents,
            currency: "AUD",
            reason: "subscription.cancel.refund",
            moduleKey: m.key,
            metadata: {
              interval: current.billingInterval,
              role: m.role,
              netCents: m.netCents,
              source: "stripe.subscription.deleted",
            },
          },
          undefined,
        );
        refundedModuleKeys.push(m.key);
      }
    }
  }

  const db = getDb();
  await db
    .update(subscriptions)
    .set({ status: "canceled", billingInterval: null, updatedAt: now })
    .where(eq(subscriptions.workspaceId, workspaceId));

  // Cascade-disable active modules (the subscription that billed them is gone).
  const active = await getInstalledModules(workspaceId);
  for (const key of active) {
    await disableModule(workspaceId, key, undefined); // webhook has no actor
  }

  await publishEvent({
    type: "SubscriptionChanged",
    workspaceId,
    entityType: "subscription",
    entityId: current.id,
    metadata: {
      from: current.billingInterval ?? "billing",
      to: "canceled",
      reason: "stripe.subscription.deleted",
      refundedModuleKeys,
    },
  });
  await writeAudit({
    workspaceId,
    action: "billing.subscription.update",
    targetType: "subscription",
    targetId: current.id,
    metadata: {
      from: current.billingInterval ?? "billing",
      to: "canceled",
      reason: "stripe.subscription.deleted",
      refundedModuleKeys,
    },
  });
}

/**
 * `invoice.paid`: audit + grant credits equal to the invoice's `amount_paid` (4c —
 * prepayment model: paying a Stripe invoice issues credit that future module charges
 * draw down). workspaceId is resolved by joining `invoice.customer` (the Stripe customer
 * id we store on start-billing) against `subscriptions.stripeCustomerId` — this Stripe
 * API version no longer exposes `subscription_details` on the top-level Invoice, so the
 * customer id is the reliable join key.
 *
 * Idempotent on `stripe_invoice_id`: a query checks for an existing grant row first
 * (caller-level guard), and a partial unique index on `credit_ledger(workspace_id,
 * stripe_invoice_id)` is DB-level defense-in-depth. A duplicate delivery that races past
 * the query throws on the index → 500 → Stripe retries → the pre-check then skips.
 */
export async function recordInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) return; // not all invoices carry a customer
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
  // Grant credits for the prepayment. Skip $0 invoices and any already-granted invoice
  // (idempotency — the processed_webhook_events pre-check guards by event id; this guards
  // by invoice id for the rare same-invoice/different-event case).
  if (invoice.amount_paid > 0) {
    const existing = await db
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.workspaceId, row.workspaceId),
          eq(creditLedger.stripeInvoiceId, invoice.id),
        ),
      )
      .limit(1);
    if (existing[0]) return; // already granted
    // Stripe returns lowercase ISO currency codes (e.g. "aud"); our ledger convention
    // is uppercase. Normalize so balance queries (which filter by currency) don't
    // fragment across cases.
    const currency = invoice.currency.toUpperCase();
    await grantCredit(row.workspaceId, {
      amountCents: invoice.amount_paid,
      currency,
      reason: "invoice.paid",
      stripeInvoiceId: invoice.id,
      metadata: { source: "stripe.invoice.paid", invoiceId: invoice.id },
    });
  }
}
