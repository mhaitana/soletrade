import { NextResponse } from "next/server";
import {
  verifyStripeWebhook,
  isStripeSignatureError,
  StripeSignatureMissingError,
} from "@/server/stripe/webhooks";
import { handleStripeEvent, recordProcessedEvent } from "@/server/stripe/handlers";

/**
 * Stripe webhook entrypoint (brief §4 — signature verification on every webhook,
 * then idempotent handling). Public (the proxy whitelists /api).
 *
 * Body MUST be read as raw text (not JSON-parsed) so Stripe's signature covers the
 * exact bytes received. `export const dynamic = "force-dynamic"` keeps the route
 * out of the static optimizer.
 *
 * On handler success the route records the event id in `processed_webhook_events`
 * (idempotent) and returns 200. On handler failure it returns 500 WITHOUT
 * recording, so Stripe retries; the pre-check in `handleStripeEvent` makes a retry
 * of an already-processed event a fast no-op.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  try {
    const event = verifyStripeWebhook(rawBody, signature);
    await handleStripeEvent(event);
    await recordProcessedEvent(event.id, event.type);
    return NextResponse.json({ received: true });
  } catch (err) {
    if (err instanceof StripeSignatureMissingError || isStripeSignatureError(err)) {
      // Bad/missing signature — Stripe should not retry these.
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }
    if (err instanceof Error && /not configured/i.test(err.message)) {
      // Unset secret — server misconfiguration, not a client error. 500 so it
      // surfaces in logs and Stripe retries once the secret is set.
      console.error("[stripe] webhook misconfiguration:", err.message);
      return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
    }
    console.error("[stripe] webhook handler failed:", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }
}
