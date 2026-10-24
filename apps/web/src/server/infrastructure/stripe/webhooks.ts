import "server-only";
import type Stripe from "stripe";
import { env } from "@/server/infrastructure/config/env";
import { getStripe } from "@/server/infrastructure/stripe/client";

/**
 * Stripe webhook verification (brief §4 - signature verification on every
 * webhook). Throws a clear boundary error if `STRIPE_WEBHOOK_SECRET` is unset,
 * and re-throws Stripe's `StripeSignatureVerificationError` when the signature
 * is missing/invalid - the route handler maps those to a 400.
 */

export function verifyStripeWebhook(rawBody: string, signature: string | null): Stripe.Event {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not configured. Set the Stripe webhook signing secret (whsec_…) in .env.local.",
    );
  }
  if (!signature) {
    throw new StripeSignatureMissingError("Missing stripe-signature header.");
  }
  // constructEvent throws Stripe.errors.StripeSignatureVerificationError on a
  // bad signature - the route handler catches that and returns 400.
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

/** Thrown when the stripe-signature header is absent. Distinct from a bad sig. */
export class StripeSignatureMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSignatureMissingError";
  }
}

export function isStripeSignatureError(err: unknown): boolean {
  // Stripe's StripeSignatureVerificationError sets `type` reliably; `name` is
  // just "Error" at runtime (the class doesn't forward its constructor name).
  if (err instanceof Error) {
    return (err as { type?: string }).type === "StripeSignatureVerificationError";
  }
  return false;
}
