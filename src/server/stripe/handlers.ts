import "server-only";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { getDb } from "@/server/db";
import { processedWebhookEvents } from "@/server/db/schema";
import {
  reconcileFromCheckoutSession,
  reconcileSubscription,
  markCanceled,
  recordInvoicePaid,
} from "@/platform/billing/reconcile";

/**
 * Stripe webhook dispatcher (brief §4 — signature verification on every webhook,
 * then idempotent handling).
 *
 * Idempotency is layered:
 *   1. `handleStripeEvent` pre-checks `processed_webhook_events` by `stripeEventId`
 *      and returns early if the event was already processed. This is the primary
 *      guard because `writeAudit` is append-only — without it a retried event
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
  const db = getDb();
  const existing = await db
    .select({ id: processedWebhookEvents.id })
    .from(processedWebhookEvents)
    .where(eq(processedWebhookEvents.stripeEventId, event.id))
    .limit(1);
  if (existing[0]) {
    console.log("[stripe] duplicate event skipped", { id: event.id, type: event.type });
    return;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await reconcileFromCheckoutSession(session);
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
    default:
      console.log("[stripe] unhandled event type", { type: event.type, id: event.id });
  }
}

/** Record a processed event idempotently (called by the route after handler success). */
export async function recordProcessedEvent(eventId: string, eventType: string): Promise<void> {
  const db = getDb();
  await db
    .insert(processedWebhookEvents)
    .values({ stripeEventId: eventId, stripeEventType: eventType })
    .onConflictDoNothing({ target: processedWebhookEvents.stripeEventId });
}
