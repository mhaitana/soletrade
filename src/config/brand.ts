/**
 * Central product branding - the single source of truth for customer-facing brand strings.
 *
 * Import this instead of duplicating product/company names across metadata, auth screens,
 * onboarding, the app shell, billing UI, email templates, public invoice/quote pages,
 * documentation helpers, structured data, and manifest generation.
 *
 * The product is **soletrade Workspace**; the company behind it is **Matt Haitana**. The repo/package
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
 * Per the spec, the public product name is title-case (`soletrade Workspace`). The `Logo`
 * component renders the wordmark at this source-string casing - the strings here are the
 * canonical title-case values.
 */
export const brand = {
  companyName: "Matt Haitana",
  productName: "soletrade Workspace",
  shortProductName: "Workspace",
  repositoryName: "soletrade",

  tagline: "One workspace to run your business.",

  description:
    "soletrade Workspace brings invoicing, quotes, bookkeeping, receipts, expenses, mileage, and earnings together in one simple business workspace.",

  shortDescription: "Invoices, books, quotes, mileage, and earnings in one workspace.",

  /** Stripe statement descriptors - unchanged by this branding pass. */
  stripeStatementDescriptor: "SOLETRADELABS",
  stripeShortenedDescriptor: "SOLETRADE",
} as const;

export type Brand = typeof brand;
