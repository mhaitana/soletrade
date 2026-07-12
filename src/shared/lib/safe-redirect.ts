/**
 * Open-redirect guard for post-authentication redirects.
 *
 * Accepts a client-supplied `next` path and returns it only if it is a safe
 * same-origin path: a single leading `/`, not `//` (protocol-relative → off-site),
 * not a scheme like `https://evil.com`. Returns `null` otherwise so callers can
 * fall back to a default destination.
 *
 * Pure + synchronous - safe to unit-test and to call from server actions, route
 * handlers, and the proxy.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  // Must start with exactly one `/` and the second char must not be `/` or a
  // scheme separator. This blocks `//evil.com`, `/\evil.com`, and `https://…`.
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  // Reject backslash-prefixed paths that browsers may treat as a scheme.
  if (next.startsWith("/\\")) return null;
  return next;
}
