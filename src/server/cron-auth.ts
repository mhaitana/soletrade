import "server-only";
import { env } from "@/shared/lib/env";

/**
 * Shared cron-secret check for `/api/cron/*` routes. Vercel Cron / an external
 * scheduler sends the shared `CRON_SECRET` as `Authorization: Bearer <secret>`
 * (or `x-cron-secret`). Routes call {@link isCronAuthorized} after handling the
 * "secret not configured" case (500) so a misconfigured scheduler surfaces
 * loudly rather than 401-ing silently.
 */

/** Constant-time string compare to avoid leaking the secret length via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // still do the comparison to keep timing roughly constant
    b = a;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0 && a.length === b.length && a.length > 0;
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
