import "server-only";
import Stripe from "stripe";
import { env } from "@/shared/lib/env";

/**
 * Stripe server client (brief §4). Boundary-asserting: throws a clear error if
 * `STRIPE_SECRET_KEY` is unset, matching the `getDataClient()` convention. The app still
 * boots without Stripe configured (4a's flows never call this); routes/handlers
 * that need Stripe call `getStripe()` at their top, which surfaces the missing
 * secret as an actionable error rather than a cryptic Stripe SDK failure.
 *
 * 4a: scaffold only — no flow calls this yet. 4b uses it for customer + unified
 * subscription creation on Pro upgrade.
 */

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client) return _client;
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Copy .env.example to .env.local and set a Stripe secret key (sk_test_… for local).",
    );
  }
  // Omit apiVersion so Stripe uses the account's default pinned version; the
  // SDK's bundled types reflect its latest API version. 4b/4c will pin this when
  // handling invoice.paid / subscription.* events to keep types stable.
  _client = new Stripe(key);
  return _client;
}

export type { Stripe };
