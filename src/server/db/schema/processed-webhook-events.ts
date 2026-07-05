import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Idempotency ledger for Stripe webhook events (brief §4). Stripe retries
 * deliveries until it gets a 2xx; without dedup a retried event would re-run the
 * reconcile handler and, because `audit_logs` is append-only, write a duplicate
 * audit row even though the subscription upsert is itself idempotent.
 *
 * The webhook route records a row here AFTER a handler succeeds
 * (`onConflictDoNothing` on the unique `stripe_event_id`). `handleStripeEvent`
 * also pre-checks this table at the top so a retry of an already-processed event
 * is a fast no-op (primary guard; handler-level state checks are defense-in-depth).
 */
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  stripeEventId: text("stripe_event_id").notNull().unique(),
  stripeEventType: text("stripe_event_type").notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});
