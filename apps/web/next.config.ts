import type { NextConfig } from "next";
import path from "node:path";

/**
 * Response headers sent with every route. They cost nothing at runtime and close off
 * whole classes of browser-side attack:
 *
 * - `X-Content-Type-Options`: stops the browser guessing a file's type (uploaded receipts
 *   and documents are served from this origin's storage links).
 * - `Referrer-Policy`: other sites receive only this site's origin, never the path, so a
 *   customer's `/i/{token}` or `/q/{token}` link is not leaked to third parties such as the
 *   payment provider.
 * - `X-Frame-Options` and `frame-ancestors`: the app cannot be embedded in another site's
 *   frame (clickjacking). Stripe's payment frames are embedded BY this app, which is
 *   unaffected.
 * - `Permissions-Policy`: the web app uses neither camera, microphone nor location, so
 *   pages and any embedded frame are denied them. `payment` is deliberately left alone:
 *   card wallets inside the Stripe frame need it.
 * - `Strict-Transport-Security` (production only): always use HTTPS for this host. It is
 *   scoped to this host on purpose; `includeSubDomains` would also bind sibling
 *   subdomains this app does not control.
 *
 * A full Content-Security-Policy (script and connect sources for Stripe and Supabase) is a
 * separate, larger change and should start in report-only mode.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000" }]
    : []),
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  experimental: {
    // Each E2E run owns a short-lived server; avoid accumulating a large disk cache.
    turbopackFileSystemCacheForDev: process.env.E2E_ENV_FILE ? false : undefined,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
