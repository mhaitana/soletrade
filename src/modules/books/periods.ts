/**
 * Books period selector (Phase 6b). Pure data — no `server-only`, no DB, no `Date` calls.
 * The page (server component) renders `PERIODS` as filter links; the loader's
 * `periodRange(period, now)` (in `actions.ts`) does the Date math server-side. Keeping the
 * labels here means the page + loader share one source of truth without one importing the
 * other's runtime.
 *
 * The default period is `"year"` (see `loadBooksPage` in `./actions.ts`).
 */

export type Period = "month" | "quarter" | "year" | "all";

export interface PeriodOption {
  key: Period;
  label: string;
}

export const PERIODS: readonly PeriodOption[] = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;

/** Default period when `?period=` is absent or invalid. */
export const DEFAULT_PERIOD: Period = "year";

/** Coerce an arbitrary string into a `Period`, falling back to the default. */
export function parsePeriod(value: string | undefined): Period {
  if (value === "month" || value === "quarter" || value === "year" || value === "all") {
    return value;
  }
  return DEFAULT_PERIOD;
}
