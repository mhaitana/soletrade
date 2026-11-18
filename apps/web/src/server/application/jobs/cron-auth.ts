import "server-only";
import { env } from "@/server/infrastructure/config/env";

/**
 * Shared cron-secret check for `/api/cron/*` routes. Vercel Cron / an external
 * scheduler sends the shared `CRON_SECRET` as `Authorization: Bearer <secret>`
 * (or `x-cron-secret`). Routes call {@link isCronAuthorized} after handling the
 * "secret not configured" case (500) so a misconfigured scheduler surfaces
 * loudly rather than 401-ing silently.
 */

/**
 * Constant-time string compare to avoid leaking the secret via timing. When the lengths
 * differ the loop still runs, against `a` itself, and the length check rejects the value.
 * The earlier version replaced `b` with `a` in that case and then compared their lengths,
 * so any value whose length differed from the secret's was accepted.
 */
function safeEqual(a: string, b: string): boolean {
  const sameLength = a.length === b.length;
  const other = sameLength ? b : a;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ other.charCodeAt(i);
  }
  return sameLength && diff === 0 && a.length > 0;
}

/** True iff the request carries the shared `CRON_SECRET` (bearer or x-cron-secret). */
export function isCronAuthorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  const headerSecret = request.headers.get("x-cron-secret");
  const provided = bearer ?? headerSecret;
  return !!provided && safeEqual(provided, secret);
}
