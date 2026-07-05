import "server-only";

/**
 * Minimal in-memory token-bucket rate limiter (Phase 5b). Guards the public
 * `createInvoicePaymentIntentAction` against abuse (the publicToken itself is 122-bit
 * unguessable, so this is defense-in-depth, not a primary control).
 *
 * **Limitation: per-instance.** State lives in module memory, so across multiple server
 * instances / serverless replicas each has its own bucket. Sufficient for dev + a
 * single-instance deploy; a multi-instance prod needs Redis or Vercel KV. Documented in
 * the Phase 5b notes.
 *
 * Fixed-window counter per key: `max` requests per `windowMs`. Lazy expiry — entries are
 * pruned on access after their window elapses, so the Map never grows unboundedly under
 * sustained traffic from one key (the window resets, not accumulates).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Returns true if the request is allowed (under the limit), false if it should be
 * rejected. Increments the counter when allowed.
 */
export function rateLimit(key: string, opts: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return true;
  }
  if (existing.count >= opts.max) {
    return false;
  }
  existing.count += 1;
  return true;
}

/** Test-only: clear all buckets between tests. */
export function clearRateLimits(): void {
  buckets.clear();
}
