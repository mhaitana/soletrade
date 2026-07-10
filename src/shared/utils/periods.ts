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

export type Period = "week" | "month" | "quarter" | "year" | "calendar" | "all";

export interface PeriodOption {
  key: Period;
  label: string;
}

// `"year"` is labelled "Current FY" — it reanchors to the workspace's financial year
// (see `periodRange`). `"calendar"` is the calendar-year window (1 Jan → now), independent
// of the FY anchor. Order mirrors granularity, matching the existing "This year" slot.
export const PERIODS: readonly PeriodOption[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "Current FY" },
  { key: "calendar", label: "Calendar year" },
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
    value === "calendar" ||
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

/** Default financial-year start month (1–12) when a caller doesn't pass one. `1` = January
 *  = calendar year, which is the historical `"year"`/`"quarter"` behaviour — so unthreaded
 *  call sites are unchanged. Loaders thread the workspace's configured `fyStartMonth`
 *  (DB default `7` = 1 July, Australian) so a real workspace's "year"/"quarter" windows
 *  reanchor to its financial year. Pure date math, no DB. */
export const DEFAULT_FY_START_MONTH = 1;

/**
 * First day (UTC midnight) of the financial year containing `now`. `fyStartMonth` is 1–12
 * (1 = January = calendar year); the FY starts on day 1 of `fyStartMonth`. If `now` is
 * before the FY-start month this year, the FY started the previous year.
 */
export function fiscalYearStart(now: Date, fyStartMonth: number = DEFAULT_FY_START_MONTH): Date {
  const startMonthIdx = fyStartMonth - 1; // 0–11
  const nowMonthIdx = now.getUTCMonth();
  const startYear = nowMonthIdx >= startMonthIdx ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(startYear, startMonthIdx, 1));
}

/**
 * First day (UTC midnight) of the financial quarter containing `now`. Quarters start at
 * `fyStartMonth`, +3, +6, +9 months (mod 12). With `fyStartMonth = 1` (default) this is the
 * calendar quarter (Jan/Apr/Jul/Oct); with `7` it's the Australian fiscal quarter
 * (Jul/Oct/Jan/Apr). Pure date math.
 */
export function fiscalQuarterStart(now: Date, fyStartMonth: number = DEFAULT_FY_START_MONTH): Date {
  const startMonthIdx = fyStartMonth - 1;
  const monthsSinceFYStart = (now.getUTCMonth() - startMonthIdx + 12) % 12;
  const quarterIndex = Math.floor(monthsSinceFYStart / 3); // 0–3
  const qStart = new Date(fiscalYearStart(now, fyStartMonth));
  qStart.setUTCMonth(qStart.getUTCMonth() + quarterIndex * 3);
  return qStart;
}

/**
 * Resolve a `Period` into an inclusive date range. `end` is always `now`; `start` is null
 * for `"all"` (no lower bound). `"year"` (labelled "Current FY") + `"quarter"` reanchor to
 * the financial year starting `fyStartMonth` (default `1` = calendar, preserving today's
 * behaviour for unthreaded callers; loaders pass the workspace's `fyStartMonth`).
 * `"calendar"` is the calendar-year window (1 Jan of `now`'s year → now), independent of the
 * FY anchor. `"week"`/`"month"` are unaffected by the FY anchor (a week/month is the same
 * regardless). UTC midnight starts.
 */
export function periodRange(
  period: Period,
  now: Date = new Date(),
  fyStartMonth: number = DEFAULT_FY_START_MONTH,
): { start: Date | null; end: Date } {
  const end = now;
  if (period === "all") return { start: null, end };
  if (period === "week") return { start: startOfWeek(now), end };
  if (period === "year") return { start: fiscalYearStart(now, fyStartMonth), end };
  if (period === "quarter") return { start: fiscalQuarterStart(now, fyStartMonth), end };
  if (period === "calendar") return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), end };
  // month
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(1);
  return { start, end };
}

/**
 * The previous period's range, for period-over-period deltas. Same window length as the
 * current period-so-far, shifted back one period (week → previous 7 days, month → previous
 * calendar month, quarter → previous quarter, year/calendar → previous year). Returns
 * `null` for `"all"` — no meaningful previous, so the caller skips the delta. `fyStartMonth`
 * threads through to `periodRange` so fiscal `"year"`/`"quarter"` shift by 12/3 months off
 * the workspace's FY anchor; `"calendar"` is FY-agnostic so the anchor is irrelevant for it.
 */
export function previousPeriodRange(
  period: Period,
  now: Date = new Date(),
  fyStartMonth: number = DEFAULT_FY_START_MONTH,
): { start: Date; end: Date } | null {
  if (period === "all") return null;
  const current = periodRange(period, now, fyStartMonth);
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
    // "year" (Current FY) | "calendar" — both are 12-month windows; shift back one year.
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    end.setUTCFullYear(end.getUTCFullYear() - 1);
  }
  return { start, end };
}
