import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/shared/lib/env";

/**
 * Rate limiter (Phase 11a hardening).
 *
 * Two backends:
 * - **Upstash Redis** (`@upstash/ratelimit` fixed-window) when both
 *   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set - state is
 *   shared across all serverless replicas, so the limit holds in prod.
 * - **In-memory fixed-window counter** otherwise (dev/test, or a single-instance
 *   deploy). Per-instance: each replica has its own buckets, so the effective
 *   limit is `max × replica_count`. Not safe for multi-instance prod.
 *
 * Fixed-window semantics: `max` requests per `windowMs` per `key`. The call is
 * async because the Upstash path awaits a network round-trip; the in-memory path
 * still resolves synchronously but returns a Promise for a uniform signature.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Cached Upstash Redis client (created once when creds are present). */
let cachedRedis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cachedRedis = null;
    return null;
  }
  cachedRedis = new Redis({ url, token });
  return cachedRedis;
}

/**
 * Cached `Ratelimit` instances keyed by `${max}:${windowMs}` - @upstash/ratelimit
 * bakes the max/window into the limiter, so one instance per distinct config.
 */
const upstashLimiters = new Map<string, Ratelimit>();
function getUpstashLimiter(max: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const cacheKey = `${max}:${windowMs}`;
  let limiter = upstashLimiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      // fixedWindow(max, window) - window is a human string; convert ms → seconds.
      limiter: Ratelimit.fixedWindow(max, `${Math.max(1, Math.round(windowMs / 1000))} s`),
      analytics: false,
    });
    upstashLimiters.set(cacheKey, limiter);
  }
  return limiter;
}

/**
 * Returns true if the request is allowed (under the limit), false if it should
 * be rejected (429). Increments the counter when allowed.
 */
export async function rateLimit(
  key: string,
  opts: { max: number; windowMs: number },
): Promise<boolean> {
  const limiter = getUpstashLimiter(opts.max, opts.windowMs);
  if (limiter) {
    const { success } = await limiter.limit(key);
    return success;
  }
  // In-memory fallback.
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

/** Test-only: clear in-memory buckets + cached clients between tests. */
export function clearRateLimits(): void {
  buckets.clear();
  cachedRedis = undefined;
  upstashLimiters.clear();
}
