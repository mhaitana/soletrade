/**
 * Pure Drive aggregation (Phase 7). No `server-only`, no DB, no time calls - unit-testable
 * in isolation, mirroring `@/modules/books/calc.ts` purity. The loader
 * (`@/app/(app)/drive/actions.ts`) fetches a period's earnings + trips and runs
 * `summarizeDrive` to produce the `/drive` summary header + per-platform breakdown + monthly
 * sparkline.
 *
 * Money is integer cents throughout; distance is integer meters (smallest unit, mirrors the
 * cents pattern). `amountCents` is always positive - defensively `Math.abs`'d so a stray
 * negative can't inflate totals. `distanceMeters` likewise `Math.abs`'d.
 *
 * The platform catalog (`@/shared/constants/drive-platforms`) is intentionally NOT imported
 * here - `calc` stays catalog-free / pure. The UI joins human labels onto the `byPlatform`
 * slugs via `platformLabel`.
 */

/** An earning reduced to the fields `summarizeDrive` needs. */
export interface EarningSummaryInput {
  /** Integer cents, expected positive. `Math.abs` is applied defensively. */
  amountCents: number;
  /** The earning's calendar date - drives the monthly grouping. */
  date: Date;
  /** Platform slug (catalog validation lives at the action boundary). */
  platform: string;
}

/** A trip reduced to the fields `summarizeDrive` needs. */
export interface TripSummaryInput {
  /** Integer meters, expected positive. `Math.abs` is applied defensively. */
  distanceMeters: number;
  /** The trip's calendar date - drives the monthly grouping. */
  date: Date;
  /** Platform slug (catalog validation lives at the action boundary). */
  platform: string;
}

export interface PlatformBreakdown {
  /** Platform slug; the UI maps it to a label via `platformLabel`. */
  platform: string;
  /** Sum of earnings cents for this platform (always positive). */
  earningsCents: number;
  /** Sum of trip distance in meters for this platform (always positive). */
  distanceMeters: number;
  /** Number of earnings rows for this platform. */
  earningsCount: number;
  /** Number of trip rows for this platform. */
  tripsCount: number;
}

export interface MonthlyDrivePoint {
  /** ISO month "YYYY-MM" (the calendar month of `date`). */
  month: string;
  earningsCents: number;
  distanceMeters: number;
}

/** Weekly point (Wave 2) - keyed by the ISO Monday of the week ("YYYY-MM-DD"). */
export interface WeeklyDrivePoint {
  /** The Monday anchoring this week, "YYYY-MM-DD" (UTC). Sortable + unambiguous. */
  week: string;
  earningsCents: number;
  distanceMeters: number;
}

/** A vehicle expense reduced to the fields `summarizeDrive` needs (Wave 2). */
export interface VehicleExpenseSummaryInput {
  /** Integer cents, expected positive. `Math.abs` is applied defensively. */
  amountCents: number;
}

export interface DriveSummary {
  totalEarningsCents: number;
  totalDistanceMeters: number;
  /** Total number of earnings rows in the period. */
  earningsCount: number;
  /** Total number of trip rows in the period. */
  tripsCount: number;
  /** Per-platform breakdown, sorted descending by `earningsCents`. */
  byPlatform: PlatformBreakdown[];
  /** Monthly points, sorted ascending by month. */
  monthly: MonthlyDrivePoint[];
  /** Weekly points, sorted ascending by week (Wave 2). */
  weekly: WeeklyDrivePoint[];
  /**
   * Mileage deduction in cents (Wave 2). `round(totalDistanceKm * mileageRateCentsPerKm)`.
   * 0 when no rate is supplied (the summary still works for workspaces that haven't set a rate).
   */
  mileageDeductionCents: number;
  /** Sum of vehicle expenses in the period (Wave 2). 0 when no expenses supplied. */
  totalExpensesCents: number;
  /** earnings − vehicle expenses − mileage deduction (can be negative). Wave 2. */
  profitCents: number;
}

/** ISO month key "YYYY-MM" from a Date (UTC, matching how DB timestamps are stored). */
function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * ISO week key: the Monday anchoring the week containing `date`, as "YYYY-MM-DD" (UTC).
 * Week starts Monday (Australian business convention). Sortable + unambiguous.
 */
function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - day); // roll back to this week's Monday
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate a set of earnings + trips into a Drive summary. Pure - no DB, no time calls.
 * Empty input → zeros + empty arrays. Earnings and trips are independent; a platform with
 * trips but no earnings (or vice versa) still appears in `byPlatform`.
 *
 * `opts.settings` + `opts.expenses` (Wave 2) are optional - when supplied, the summary also
 * computes the mileage deduction, total vehicle expenses, and net profit. Omit them for
 * the pre-Wave-2 callers (the dashboard loader); the new fields default to 0.
 */
export function summarizeDrive(
  earnings: readonly EarningSummaryInput[],
  trips: readonly TripSummaryInput[],
  opts?: {
    settings?: { mileageRateCentsPerKm: number };
    expenses?: readonly VehicleExpenseSummaryInput[];
  },
): DriveSummary {
  let totalEarningsCents = 0;
  let totalDistanceMeters = 0;
  let earningsCount = 0;
  let tripsCount = 0;

  // Per-platform aggregation. Insertion order is tracked so the final sort is stable when
  // earnings amounts tie.
  const platformMap = new Map<string, PlatformBreakdown>();
  // Per month aggregation, keyed "YYYY-MM".
  const monthMap = new Map<string, MonthlyDrivePoint>();
  // Per ISO week aggregation, keyed by the week's Monday "YYYY-MM-DD" (Wave 2).
  const weekMap = new Map<string, WeeklyDrivePoint>();

  for (const e of earnings) {
    const amount = Math.abs(e.amountCents);
    totalEarningsCents += amount;
    earningsCount += 1;

    const existing = platformMap.get(e.platform);
    if (existing) {
      existing.earningsCents += amount;
      existing.earningsCount += 1;
    } else {
      platformMap.set(e.platform, {
        platform: e.platform,
        earningsCents: amount,
        distanceMeters: 0,
        earningsCount: 1,
        tripsCount: 0,
      });
    }

    const mk = monthKey(e.date);
    const month = monthMap.get(mk);
    if (month) {
      month.earningsCents += amount;
    } else {
      monthMap.set(mk, { month: mk, earningsCents: amount, distanceMeters: 0 });
    }

    const wk = weekKey(e.date);
    const week = weekMap.get(wk);
    if (week) {
      week.earningsCents += amount;
    } else {
      weekMap.set(wk, { week: wk, earningsCents: amount, distanceMeters: 0 });
    }
  }

  for (const t of trips) {
    const distance = Math.abs(t.distanceMeters);
    totalDistanceMeters += distance;
    tripsCount += 1;

    const existing = platformMap.get(t.platform);
    if (existing) {
      existing.distanceMeters += distance;
      existing.tripsCount += 1;
    } else {
      platformMap.set(t.platform, {
        platform: t.platform,
        earningsCents: 0,
        distanceMeters: distance,
        earningsCount: 0,
        tripsCount: 1,
      });
    }

    const mk = monthKey(t.date);
    const month = monthMap.get(mk);
    if (month) {
      month.distanceMeters += distance;
    } else {
      monthMap.set(mk, { month: mk, earningsCents: 0, distanceMeters: distance });
    }

    const wk = weekKey(t.date);
    const week = weekMap.get(wk);
    if (week) {
      week.distanceMeters += distance;
    } else {
      weekMap.set(wk, { week: wk, earningsCents: 0, distanceMeters: distance });
    }
  }

  const byPlatform = [...platformMap.values()].sort((a, b) => b.earningsCents - a.earningsCents);

  const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const weekly = [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week));

  // Mileage deduction (ATO cents-per-km): round(totalDistanceKm * rate). 0 when no rate.
  const rate = opts?.settings?.mileageRateCentsPerKm ?? 0;
  const mileageDeductionCents = rate > 0 ? Math.round((totalDistanceMeters / 1000) * rate) : 0;

  // Total vehicle expenses in the period (0 when none supplied).
  let totalExpensesCents = 0;
  for (const exp of opts?.expenses ?? []) {
    totalExpensesCents += Math.abs(exp.amountCents);
  }

  const profitCents = totalEarningsCents - totalExpensesCents - mileageDeductionCents;

  return {
    totalEarningsCents,
    totalDistanceMeters,
    earningsCount,
    tripsCount,
    byPlatform,
    monthly,
    weekly,
    mileageDeductionCents,
    totalExpensesCents,
    profitCents,
  };
}

/**
 * Format an integer meter count as a kilometres string with one decimal, e.g. `45200` →
 * `"45.2 km"`. Pure - used by both server + client renders. `Math.abs` so a stray negative
 * never renders a minus sign on a distance.
 */
export function formatKm(meters: number): string {
  const km = Math.abs(meters) / 1000;
  return `${km.toFixed(1)} km`;
}
