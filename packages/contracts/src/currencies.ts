/** Platform-independent currency and workspace locale contract. */
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
 *  text, so a user can type a custom zone too - this list is just the convenience picker. */
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

/** A financial-year start month option for the settings `<select>`. Pure data (no `server-only`)
 *  so both the client settings form and the server action/service can import it. The workspace
 *  `fyStartMonth` column stores 1–12 (1 = January = calendar year). */
export interface FinancialYearStartMonth {
  /** Month-of-year stored on the workspace row (1–12). */
  month: number;
  /** Human label for the settings `<select>`, e.g. "1 January", "7 July". */
  label: string;
}

/** The 12 financial-year start options, January→December. Drives GST/BAS quarter labels + the
 *  "year"/"quarter" period-selector windows. Defaults to 7 (1 July, Australian) at the DB level. */
export const FINANCIAL_YEAR_START_MONTHS: readonly FinancialYearStartMonth[] = [
  { month: 1, label: "1 January" },
  { month: 2, label: "1 February" },
  { month: 3, label: "1 March" },
  { month: 4, label: "1 April" },
  { month: 5, label: "1 May" },
  { month: 6, label: "1 June" },
  { month: 7, label: "1 July" },
  { month: 8, label: "1 August" },
  { month: 9, label: "1 September" },
  { month: 10, label: "1 October" },
  { month: 11, label: "1 November" },
  { month: 12, label: "1 December" },
];

/** Month-of-year values the workspace `fyStartMonth` column accepts. Const tuple so
 *  `z.enum`/`z.number().int().min(1).max(12)` get a literal union/range for validation. */
export const FINANCIAL_YEAR_START_MONTH_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
