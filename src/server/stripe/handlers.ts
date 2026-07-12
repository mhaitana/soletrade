import "server-only";
import type Stripe from "stripe";
import { getDataClient } from "@/server/db/client";
import { unwrapMaybe, unwrapVoid } from "@/server/db/helpers";
import { getStripe } from "@/server/stripe/client";
import { buildPriceIdToModuleMap } from "@/server/stripe/prices";
import {
  reconcileFromCheckoutSession,
  reconcileSubscription,
  markCanceled,
  recordInvoicePaid,
  type CheckoutItem,
} from "@/platform/billing/reconcile";
import { markInvoicePaidByStripe } from "@/modules/invoices";
import { branded } from "@/shared/types/ids";
import type { BillingInterval } from "@/server/db/enums";

/**
 * Stripe webhook dispatcher (brief §4 - signature verification on every webhook,
 * then idempotent handling).
 *
 * Idempotency is layered:
 *   1. `handleStripeEvent` pre-checks `processed_webhook_events` by `stripeEventId`
 *      and returns early if the event was already processed. This is the primary
 *      guard because `writeAudit` is append-only - without it a retried event
 *      would re-run reconcile and duplicate the audit row even though the
 *      subscription upsert is itself idempotent.
 *   2. Each reconcile function checks current state before writing
 *      (defense-in-depth for the rare concurrent-duplicate-delivery case).
 *
 * The route records the event AFTER the handler succeeds
 * (`recordProcessedEvent`, `onConflictDoNothing`). On handler error the route
 * returns 500 before recording, so Stripe retries.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  const supabase = getDataClient();
  const existing = await unwrapMaybe(
    supabase
      .from("processed_webhook_events")
      .select("id")
      .eq("stripe_event_id", event.id)
      .limit(1)
      .maybeSingle(),
  );
  if (existing) {
    console.log("[stripe] duplicate event skipped", { id: event.id, type: event.type });
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await reconcileCheckoutSession(session);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await reconcileSubscription(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await markCanceled(sub);
      break;
    }
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      await recordInvoicePaid(invoice);
      break;
    }
    case "payment_intent.succeeded": {
      const pi = event.data.object as Stripe.PaymentIntent;
      await reconcileInvoicePayment(pi);
      break;
    }
    default:
      console.log("[stripe] unhandled event type", { type: event.type, id: event.id });
  }
}

/** Record a processed event idempotently (called by the route after handler success). */
export async function recordProcessedEvent(eventId: string, eventType: string): Promise<void> {
  const supabase = getDataClient();
  // Idempotent: the partial-unique index on `stripe_event_id` is the guard;
  // `ignoreDuplicates:true` makes a retried event a no-op rather than an error.
  await unwrapVoid(
    supabase
      .from("processed_webhook_events")
      .upsert(
        { stripe_event_id: eventId, stripe_event_type: eventType },
        { onConflict: "stripe_event_id", ignoreDuplicates: true },
      ),
  );
}

/**
 * `checkout.session.completed` Stripe I/O: retrieve the subscription (expanding its
 * items + prices), read the chosen billing interval from `subscription.metadata`, map
 * each item's price id back to a module + role, then hand the resolved payload to the
 * reconcile function (which owns the DB writes). Keeps Stripe SDK usage out of
 * `@/platform/billing/reconcile`.
 */
async function reconcileCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  if (!session.subscription || typeof session.subscription !== "string") {
    console.error("[stripe] checkout.session.completed has no subscription id", { id: session.id });
    return;
  }
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(session.subscription, {
    expand: ["items.data.price"],
  });
  const interval = sub.metadata?.interval as BillingInterval | undefined;
  if (interval !== "monthly" && interval !== "annual") {
    console.error("[stripe] checkout.session.completed subscription missing metadata.interval", {
      id: session.id,
      subId: sub.id,
    });
    return;
  }
  const priceMap = buildPriceIdToModuleMap();
  const items: CheckoutItem[] = [];
  for (const si of sub.items.data) {
    const priceId = typeof si.price === "string" ? si.price : si.price?.id;
    if (!priceId) continue;
    const mapping = priceMap.get(priceId);
    if (!mapping) continue; // unrelated price - skip defensively
    items.push({ moduleKey: mapping.moduleKey, role: mapping.role, itemId: si.id });
  }
  await reconcileFromCheckoutSession(session, { interval, items });
}

/**
 * `payment_intent.succeeded` (5b - customer paying a soletrade invoice, NOT the subscription
 * billing invoice handled by `recordInvoicePaid` above). The PaymentIntent carries
 * `metadata.invoiceId` + `metadata.workspaceId` set by `createInvoicePaymentIntentAction`.
 * Hands off to the invoices service, which atomically flips the invoice to `paid` (idempotent
 * - the `processed_webhook_events` pre-check by event id is the primary guard; the service
 * `inArray(status, ["sent","viewed","overdue"])` guard is defense-in-depth for the rare
 * same-PI/different-event case). PIs without our metadata are ignored defensively.
 */
export async function reconcileInvoicePayment(pi: Stripe.PaymentIntent): Promise<void> {
  const invoiceId = pi.metadata?.invoiceId;
  const workspaceId = pi.metadata?.workspaceId;
  if (!invoiceId || !workspaceId) {
    // Not a PI we created (e.g. test/legacy) - nothing to reconcile.
    return;
  }
  const latestChargeId =
    typeof pi.latest_charge === "string" ? pi.latest_charge : (pi.latest_charge?.id ?? null);

  await markInvoicePaidByStripe(
    branded<"WorkspaceId">(workspaceId),
    branded<"InvoiceId">(invoiceId),
    pi.id,
    latestChargeId,
  );
}
