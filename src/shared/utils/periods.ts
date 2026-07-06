/**
 * Period selector + period date-range resolver (Phase 6b, moved to shared in Phase 7; the
 * `periodRange` / `previousPeriodRange` Date math was extracted here in Phase 9 from the
 * duplicated copies in `books/actions.ts` + `drive/actions.ts`). No `server-only`, no DB.
 * `parsePeriod` is pure data; `periodRange` / `previousPeriodRange` take an explicit `now`
 * (defaulting to `new Date()`) so they're deterministic + unit-testable.
 *
 * The default period is `"year"` for Books/Drive (see `loadBooksPage` / `loadDrivePage`); the
 * cross-module dashboard defaults to `"month"` so its deltas read "vs last month".
 *
 * Range semantics: `periodRange` returns `{ start, end }` where `end` is `now` (a partial
 * period so far). `previousPeriodRange` returns the **same-length window shifted back one
 * period** (e.g. today is July 5 → previous month = June 1–June 5), so period-over-period
 * deltas are a fair comparison, not partial-current-vs-full-previous. Returns `null` for
 * `"all"` (no meaningful previous period — deltas are `null` in that case).
 */

export type Period = "week" | "month" | "quarter" | "year" | "all";

export interface PeriodOption {
  key: Period;
  label: string;
}

export const PERIODS: readonly PeriodOption[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;

/** Default period when `?period=` is absent or invalid. */
export const DEFAULT_PERIOD: Period = "year";

/** Coerce an arbitrary string into a `Period`, falling back to the default. */
export function parsePeriod(value: string | undefined): Period {
  if (
    value === "week" ||
    value === "month" ||
    value === "quarter" ||
    value === "year" ||
    value === "all"
  ) {
    return value;
  }
  return DEFAULT_PERIOD;
}

/**
 * The Monday anchoring the week containing `now` (UTC midnight). Week starts Monday
 * (Australian business convention). Pure date math, no DB.
 */
export function startOfWeek(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - day); // roll back to this week's Monday
  return d;
}

/**
 * Resolve a `Period` into an inclusive date range. `end` is always `now`; `start` is null
 * for `"all"` (no lower bound). Quarter start = first day of the current quarter
 * (months 0/3/6/9 → `Math.floor(month/3)*3`). Week start = the Monday of the current week
 * (Australian business week starts Monday). All comparisons are UTC midnight.
 */
export function periodRange(
  period: Period,
  now: Date = new Date(),
): { start: Date | null; end: Date } {
  const end = now;
  if (period === "all") return { start: null, end };
  if (period === "week") return { start: startOfWeek(now), end };
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  if (period === "month") {
    start.setUTCDate(1);
  } else if (period === "quarter") {
    start.setUTCDate(1);
    start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
  } else {
    // year
    start.setUTCDate(1);
    start.setUTCMonth(0);
  }
  return { start, end };
}

/**
 * The previous period's range, for period-over-period deltas. Same window length as the
 * current period-so-far, shifted back one period (week → previous 7 days, month → previous
 * calendar month, quarter → previous quarter, year → previous year). Returns `null` for
 * `"all"` — no meaningful previous, so the caller skips the delta.
 */
export function previousPeriodRange(
  period: Period,
  now: Date = new Date(),
): { start: Date; end: Date } | null {
  if (period === "all") return null;
  const current = periodRange(period, now);
  // `current.start` is non-null for week/month/quarter/year (only "all" returns null, handled above).
  const start = new Date(current.start as Date);
  const end = new Date(now);
  if (period === "week") {
    start.setUTCDate(start.getUTCDate() - 7);
    end.setUTCDate(end.getUTCDate() - 7);
  } else if (period === "month") {
    start.setUTCMonth(start.getUTCMonth() - 1);
    end.setUTCMonth(end.getUTCMonth() - 1);
  } else if (period === "quarter") {
    start.setUTCMonth(start.getUTCMonth() - 3);
    end.setUTCMonth(end.getUTCMonth() - 3);
  } else {
    // year
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    end.setUTCFullYear(end.getUTCFullYear() - 1);
  }
  return { start, end };
}
