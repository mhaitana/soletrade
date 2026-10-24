/**
 * Central application URL configuration - the single source of truth for deployment URLs.
 *
 * The final production application domain is not hard-coded here. All URLs are read from
 * `NEXT_PUBLIC_*` env vars (validated in `src/shared/lib/env.ts`) so the same build can deploy to
 * any configured domain (`app.soletrade.example`, `workspace.soletrade.example`, `workspace.soletrade.example`,
 * …). Callback URLs, Stripe return URLs, email links, and public invoice/quote links are all
 * derived from `urls.app`.
 *
 * Only `NEXT_PUBLIC_*` vars are used, so this module is safe to import from both server and client
 * code (the values are inlined at build time).
 */
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://www.soletrade.example";

export const urls = {
  app: appUrl,
  marketing: marketingUrl,
  // Legal/support pages are hosted on the app domain (NEXT_PUBLIC_APP_URL). The footer links
  // here point at these; override per-link with the explicit *_URL env vars if you host them
  // elsewhere.
  support: process.env.NEXT_PUBLIC_SUPPORT_URL ?? `${appUrl}/support`,
  privacy: process.env.NEXT_PUBLIC_PRIVACY_URL ?? `${appUrl}/privacy`,
  terms: process.env.NEXT_PUBLIC_TERMS_URL ?? `${appUrl}/terms`,
} as const;

export type Urls = typeof urls;
