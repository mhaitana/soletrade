/**
 * Supported currencies (Wave 4 — workspace `defaultCurrency` setting). Pure data — no
 * `server-only`, no app/module/platform imports, so both the client settings form and the
 * server action/service can import it without dragging server-only into the client bundle.
 * Mirrors the `src/shared/constants/drive-platforms` pattern: data only (validation lives in
 * the action/service, satisfying "no business logic in `src/shared/*`").
 *
 * ISO 4217 codes. The workspace `defaultCurrency` column stores one of these as `text`
 * (default "AUD"). New invoices/quotes/transactions default to the workspace currency when
 * the caller doesn't override `currency` (a customer may be billed in USD while the workspace
 * defaults to AUD).
 */
export interface Currency {
  /** ISO 4217 code stored on the row. */
  code: string;
  /** Human label shown in the settings `<select>`. */
  label: string;
  /** Currency symbol used by the money formatter. */
  symbol: string;
}

/** ISO 4217 codes the workspace `defaultCurrency` column accepts. Declared as a const tuple so
 *  `z.enum(SUPPORTED_CURRENCY_CODES)` gets a literal union (`"AUD" | "USD" | …`) for free. */
export const SUPPORTED_CURRENCY_CODES = ["AUD", "USD", "EUR", "GBP", "NZD", "CAD", "SGD"] as const;

export const SUPPORTED_CURRENCIES: readonly Currency[] = [
  { code: "AUD", label: "Australian Dollar", symbol: "$" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "NZD", label: "New Zealand Dollar", symbol: "$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "$" },
  { code: "SGD", label: "Singapore Dollar", symbol: "$" },
];

export function isSupportedCurrency(code: string): boolean {
  return (SUPPORTED_CURRENCY_CODES as readonly string[]).includes(code);
}

/** Common IANA timezones for the settings `<select>`. The column stores any IANA zone as
 *  text, so a user can type a custom zone too — this list is just the convenience picker. */
export const COMMON_TIMEZONES: readonly string[] = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Pacific/Auckland",
  "Pacific/Honolulu",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Hong_Kong",
  "Asia/Dubai",
  "UTC",
];
