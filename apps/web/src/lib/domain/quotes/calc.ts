/**
 * Pure Quotes dashboard aggregator (Phase 9). No `server-only`, no DB, no time calls -
 * unit-testable in isolation, mirroring `@/modules/books/calc.ts` + `@/modules/drive/calc.ts` +
 * `@/modules/invoices/calc.ts` purity. The cross-module dashboard loader fetches a workspace's
 * quotes (capped at 200 by `listQuotes`) and runs `summarizeQuotes` for the current + previous
 * period to produce the dashboard's "Pending quotes value / sent / accepted / declined /
 * converted" KPIs + an accepted-by-month sparkline.
 *
 * Money is integer cents throughout.
 *
 * **Range semantics:** `acceptedValueCents` is a **current-state snapshot** - the sum of
 * `totalCents` for status === "accepted" (pending conversion), all-time, ignoring `range`.
 * `sentCount` / `acceptedCount` / `declinedCount` / `convertedCount` and `monthly` are
 * **period-bound** - a row counts if its relevant event date (`sentAt`/`acceptedAt`/
 * `declinedAt`/`convertedAt`) falls in `[range.start, range.end]`. `range.start == null` means
 * no lower bound (the "all" period). The loader runs this twice (current + previous range) for
 * the acceptedCount delta; `acceptedValueCents` comes from the current call only.
 */

import type { QuoteStatus } from "@/lib/domain/database-enums";

/** A quote reduced to the fields `summarizeQuotes` needs. */
export interface QuoteSummaryInput {
  status: QuoteStatus;
  /** Integer cents - the quote total. */
  totalCents: number;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  convertedAt: Date | null;
  /** The quote's issue date (unused for bucketing but kept for completeness/future use). */
  issueDate: Date;
}

export interface MonthlyQuotePoint {
  /** ISO month "YYYY-MM" (the calendar month of `acceptedAt`). */
  month: string;
  /** Total cents of quotes accepted in this month. */
  acceptedCents: number;
  /** Number of quotes accepted in this month. */
  acceptedCount: number;
}

export interface QuoteSummary {
  /** Sum of `totalCents` for status === "accepted" (pending conversion) - all-time snapshot. */
  acceptedValueCents: number;
  /** Count of quotes sent in range. */
  sentCount: number;
  /** Count of quotes accepted in range. */
  acceptedCount: number;
  /** Count of quotes declined in range. */
  declinedCount: number;
  /** Count of quotes converted to invoices in range. */
  convertedCount: number;
  /** Accepted-by-month series (in range), sorted ascending by month - for the sparkline. */
  monthly: MonthlyQuotePoint[];
}

/** ISO month key "YYYY-MM" from a Date (UTC, matching how DB timestamps are stored). */
function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Whether `date` falls in `[start, end]` (start null → no lower bound). */
function inRange(date: Date, range: { start: Date | null; end: Date }): boolean {
  return (!range.start || date >= range.start) && date <= range.end;
}

/**
 * Aggregate a set of quotes into a dashboard summary. Pure - no DB, no time calls.
 * Empty input → zeros + empty `monthly`.
 */
export function summarizeQuotes(
  rows: readonly QuoteSummaryInput[],
  range: { start: Date | null; end: Date },
): QuoteSummary {
  let acceptedValueCents = 0;
  let sentCount = 0;
  let acceptedCount = 0;
  let declinedCount = 0;
  let convertedCount = 0;

  const monthMap = new Map<string, MonthlyQuotePoint>();

  for (const row of rows) {
    // Snapshot - all-time, ignore range.
    if (row.status === "accepted") {
      acceptedValueCents += row.totalCents;
    }

    // Period-bound counts.
    if (row.sentAt && inRange(row.sentAt, range)) sentCount += 1;
    if (row.acceptedAt && inRange(row.acceptedAt, range)) {
      acceptedCount += 1;
      const mk = monthKey(row.acceptedAt);
      const month = monthMap.get(mk);
      if (month) {
        month.acceptedCents += row.totalCents;
        month.acceptedCount += 1;
      } else {
        monthMap.set(mk, {
          month: mk,
          acceptedCents: row.totalCents,
          acceptedCount: 1,
        });
      }
    }
    if (row.declinedAt && inRange(row.declinedAt, range)) declinedCount += 1;
    if (row.convertedAt && inRange(row.convertedAt, range)) convertedCount += 1;
  }

  const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  return {
    acceptedValueCents,
    sentCount,
    acceptedCount,
    declinedCount,
    convertedCount,
    monthly,
  };
}
