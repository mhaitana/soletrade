/**
 * Central product branding - the single source of truth for customer-facing brand strings.
 *
 * Import this instead of duplicating product/company names across metadata, auth screens,
 * onboarding, the app shell, billing UI, email templates, public invoice/quote pages,
 * documentation helpers, structured data, and manifest generation.
 *
 * The product is **Soletrade Workspace**; the company behind it is **Matt Haitana**. The repo/package
 * name stays `soletrade` (a stable technical identifier, not a customer-facing brand). The
 * `workspace` tenant domain model (`workspaceId`, `workspaceMember`, …) is a separate concept from
 * the product name and is intentionally not renamed here.
 *
 * `companyName` ("Matt Haitana") is the **copyright / legal entity only** — it appears in the
 * site metadata (`creator`/`publisher`), the Stripe statement descriptor, and a © line. Do NOT
 * render it as a product byline (e.g. "a Matt Haitana product", "by Matt Haitana", or as the
 * issuer on merchant documents). Product-facing surfaces use `productName`; merchant document
 * fallbacks use `productName`, never `companyName`.
 *
 * `productName` ("Soletrade Workspace") is the prose product name — metadata titles, email body,
 * Stripe product names, the hero/legal eyebrow, "Powered by" footers. `wordmark` ("soletrade")
 * is the **visual logo lockup** — the `Logo` full variant and the email/PDF brand headers render
 * this, not the product name. `shortProductName` ("Workspace") is the in-app compact label and
 * the manifest short_name.
 */
export const brand = {
  companyName: "Matt Haitana",
  productName: "Soletrade Workspace",
  wordmark: "soletrade",
  shortProductName: "Workspace",
  repositoryName: "soletrade",

  tagline: "One workspace to run your business.",

  description:
    "Soletrade Workspace brings invoicing, quotes, bookkeeping, receipts, expenses, mileage, and earnings together in one simple business workspace.",

  shortDescription: "Invoices, books, quotes, mileage, and earnings in one workspace.",

  /** Stripe statement descriptors - unchanged by this branding pass. */
  stripeStatementDescriptor: "SOLETRADELABS",
  stripeShortenedDescriptor: "SOLETRADE",
} as const;

export type Brand = typeof brand;
