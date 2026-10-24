/**
 * Pure Invoices dashboard aggregator (Phase 9). No `server-only`, no DB, no time calls -
 * unit-testable in isolation, mirroring `@/modules/books/calc.ts` + `@/modules/drive/calc.ts`
 * purity. The cross-module dashboard loader fetches a workspace's invoices (capped at 200 by
 * `listInvoices`) and runs `summarizeInvoices` for the current + previous period to produce
 * the dashboard's outstanding/overdue/draft metrics and business-income input + a paid-by-month
 * sparkline.
 *
 * Money is integer cents throughout.
 *
 * **Range semantics:** `outstandingCents`, `overdueCount`, `draftCount` are **current-state
 * snapshots** - they ignore `range` and reflect the workspace's invoices as-of-now (an invoice
 * is outstanding/overdue/draft regardless of when it was issued). `paidCents`, `paidCount`,
 * `sentCount`, and `monthly` are **period-bound** - a row counts if its relevant event date
 * (`paidAt` for paid, `sentAt` for sent) falls in `[range.start, range.end]`. `range.start ==
 * null` means no lower bound (the "all" period). The loader runs this twice (current + previous
 * range) for the income delta; the snapshots come from the current call only.
 */

import type { InvoiceStatus } from "@/lib/domain/database-enums";

/** An invoice reduced to the fields `summarizeInvoices` needs. */
export interface InvoiceSummaryInput {
  status: InvoiceStatus;
  /** Integer cents - the invoice total. */
  totalCents: number;
  /** When the invoice was sent (null for drafts). Drives `sentCount`. */
  sentAt: Date | null;
  /** When the invoice was paid (null unless status === "paid"). Drives `paidCents`/`paidCount`/`monthly`. */
  paidAt: Date | null;
  /** The invoice's issue date - used as a fallback for monthly bucketing if `paidAt` is null. */
  issueDate: Date;
}

export interface MonthlyInvoicePoint {
  /** ISO month "YYYY-MM" (the calendar month of `paidAt`). */
  month: string;
  /** Total cents paid in this month. */
  paidCents: number;
  /** Number of invoices paid in this month. */
  paidCount: number;
}

export interface InvoiceSummary {
  /** Sum of `totalCents` for status in (sent, viewed, overdue) - outstanding, all-time snapshot. */
  outstandingCents: number;
  /** Count of status === "overdue" - all-time snapshot. */
  overdueCount: number;
  /** Count of status === "draft" - all-time snapshot. */
  draftCount: number;
  /** Sum of `totalCents` for invoices paid in range. */
  paidCents: number;
  /** Count of invoices paid in range. */
  paidCount: number;
  /** Count of invoices sent in range. */
  sentCount: number;
  /** Paid-by-month series (in range), sorted ascending by month - for the sparkline. */
  monthly: MonthlyInvoicePoint[];
}

/** ISO month key "YYYY-MM" from a Date (UTC, matching how DB timestamps are stored). */
function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Whether `date` falls in `[start, end]` (start null → no lower bound). */
function inRange(date: Date, range: { start: Date | null; end: Date }): boolean {
  return (!range.start || date >= range.start) && date <= range.end;
}

const OUTSTANDING_STATUSES: ReadonlySet<InvoiceStatus> = new Set(["sent", "viewed", "overdue"]);

/**
 * Aggregate a set of invoices into a dashboard summary. Pure - no DB, no time calls.
 * Empty input → zeros + empty `monthly`.
 */
export function summarizeInvoices(
  rows: readonly InvoiceSummaryInput[],
  range: { start: Date | null; end: Date },
): InvoiceSummary {
  let outstandingCents = 0;
  let overdueCount = 0;
  let draftCount = 0;
  let paidCents = 0;
  let paidCount = 0;
  let sentCount = 0;

  const monthMap = new Map<string, MonthlyInvoicePoint>();

  for (const row of rows) {
    // Snapshots - all-time, ignore range.
    if (OUTSTANDING_STATUSES.has(row.status)) {
      outstandingCents += row.totalCents;
    }
    if (row.status === "overdue") overdueCount += 1;
    if (row.status === "draft") draftCount += 1;

    // Period-bound: paid in range.
    if (row.status === "paid" && row.paidAt && inRange(row.paidAt, range)) {
      paidCents += row.totalCents;
      paidCount += 1;
      const mk = monthKey(row.paidAt);
      const month = monthMap.get(mk);
      if (month) {
        month.paidCents += row.totalCents;
        month.paidCount += 1;
      } else {
        monthMap.set(mk, { month: mk, paidCents: row.totalCents, paidCount: 1 });
      }
    }

    // Period-bound: sent in range.
    if (row.sentAt && inRange(row.sentAt, range)) {
      sentCount += 1;
    }
  }

  const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  return {
    outstandingCents,
    overdueCount,
    draftCount,
    paidCents,
    paidCount,
    sentCount,
    monthly,
  };
}
