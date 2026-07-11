/**
 * Pure Books P&L aggregation (Phase 6b). No `server-only`, no DB, no time calls —
 * unit-testable in isolation, mirroring `@/modules/invoices/totals.ts` purity. The loader
 * (`@/app/(app)/books/actions.ts`) fetches a period's transactions and runs
 * `summarizeTransactions` to produce the `/books` summary header + category breakdown +
 * monthly sparkline. The cross-module dashboard phase (later) can reuse this same function
 * to render a richer Recharts view.
 *
 * Money is integer cents throughout. `amountCents` is always positive (sign is implied by
 * `type`); defensively `Math.abs`'d so a stray negative expense can't inflate income.
 *
 * The category catalog (`@/shared/constants/books-categories`) is intentionally NOT
 * imported here — `calc` stays catalog-free / pure. The UI joins human labels onto the
 * `byCategory` slugs via `categoryLabel`.
 */

import type { BookType } from "@/server/db/enums";

/** A transaction reduced to the fields `summarizeTransactions` needs. */
export interface TransactionSummaryInput {
  type: BookType;
  /** Integer cents, expected positive. `Math.abs` is applied defensively. */
  amountCents: number;
  /** The transaction's calendar date — drives the monthly grouping. */
  date: Date;
  /** Category slug (catalog validation lives at the action boundary). */
  category: string;
  /**
   * GST portion of this transaction in cents (Wave 2). Optional for backward-compat
   * with callers that don't carry GST — defaults to 0. Income GST is "collected"
   * (remittable); expense GST is "paid" (claimable as an input tax credit).
   */
  gstCents?: number;
}

export interface CategoryBreakdown {
  type: BookType;
  /** Category slug; the UI maps it to a label via `categoryLabel`. */
  category: string;
  /** Sum of `amountCents` for this type+category (always positive). */
  amountCents: number;
  count: number;
}

export interface MonthlyNetPoint {
  /** ISO month "YYYY-MM" (the calendar month of `date`). */
  month: string;
  incomeCents: number;
  expenseCents: number;
  /** income - expense (can be negative). */
  netCents: number;
}

export interface TransactionSummary {
  incomeCents: number;
  expenseCents: number;
  /** income - expense (can be negative). */
  netCents: number;
  /** GST collected from customers (sum of income `gstCents`). */
  gstCollectedCents: number;
  /** GST paid on expenses (claimable input tax credits). */
  gstPaidCents: number;
  /** gstCollected - gstPaid (the net GST position; can be negative = refund due). */
  netGstCents: number;
  count: number;
  /** Income categories first (desc by amount), then expense categories (desc by amount). */
  byCategory: CategoryBreakdown[];
  /** Monthly net points, sorted ascending by month. */
  monthly: MonthlyNetPoint[];
}

/** ISO month key "YYYY-MM" from a Date (UTC, matching how DB timestamps are stored). */
function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * Aggregate a set of transactions into a P&L summary. Pure — no DB, no time calls.
 * Empty input → zeros + empty arrays.
 */
export function summarizeTransactions(
  rows: readonly TransactionSummaryInput[],
): TransactionSummary {
  let incomeCents = 0;
  let expenseCents = 0;
  let gstCollectedCents = 0;
  let gstPaidCents = 0;
  let count = 0;

  // Per type|category aggregation. Insertion order is tracked so the final sort is stable
  // within a type when amounts tie.
  const catMap = new Map<string, CategoryBreakdown>();
  // Per month aggregation, keyed "YYYY-MM".
  const monthMap = new Map<string, MonthlyNetPoint>();

  for (const row of rows) {
    const amount = Math.abs(row.amountCents);
    const gst = Math.abs(row.gstCents ?? 0);
    count += 1;
    if (row.type === "income") {
      incomeCents += amount;
      gstCollectedCents += gst;
    } else {
      expenseCents += amount;
      gstPaidCents += gst;
    }

    const catKey = `${row.type}|${row.category}`;
    const existing = catMap.get(catKey);
    if (existing) {
      existing.amountCents += amount;
      existing.count += 1;
    } else {
      catMap.set(catKey, {
        type: row.type,
        category: row.category,
        amountCents: amount,
        count: 1,
      });
    }

    const mk = monthKey(row.date);
    const month = monthMap.get(mk);
    if (month) {
      if (row.type === "income") month.incomeCents += amount;
      else month.expenseCents += amount;
      month.netCents = month.incomeCents - month.expenseCents;
    } else {
      const income = row.type === "income" ? amount : 0;
      const expense = row.type === "expense" ? amount : 0;
      monthMap.set(mk, {
        month: mk,
        incomeCents: income,
        expenseCents: expense,
        netCents: income - expense,
      });
    }
  }

  const byCategory = [...catMap.values()].sort((a, b) => {
    // Income categories first, then expense; within each, descending by amount.
    if (a.type !== b.type) return a.type === "income" ? -1 : 1;
    return b.amountCents - a.amountCents;
  });

  const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  return {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    gstCollectedCents,
    gstPaidCents,
    netGstCents: gstCollectedCents - gstPaidCents,
    count,
    byCategory,
    monthly,
  };
}

/**
 * A transaction reduced to the fields `summarizeGst` needs. Pure subset of
 * `TransactionSummaryInput` + `gstCents`.
 */
export interface GstSummaryInput {
  type: BookType;
  /** GST portion in cents (income = collected, expense = paid/claimable). */
  gstCents: number;
  /** The transaction's calendar date — drives the quarter grouping. */
  date: Date;
}

export interface GstQuarterPoint {
  /** Financial-year quarter label, e.g. "2026-Q1" (FY2026–27, Q1 = Jul–Sep 2026). */
  label: string;
  fiscalYear: number;
  quarter: number;
  gstCollectedCents: number;
  gstPaidCents: number;
  /** collected − paid (can be negative = refund due). */
  netGstCents: number;
}

export interface GstSummary {
  gstCollectedCents: number;
  gstPaidCents: number;
  netGstCents: number;
  /** Per-quarter breakdown, sorted ascending by (fiscalYear, quarter). */
  byQuarter: GstQuarterPoint[];
}

/**
 * Map a calendar date to the financial-year quarter. `fyStartMonth` is 1–12 (1 = January =
 * calendar year); default `7` = 1 July (Australian) — the historical behaviour, so
 * unthreaded callers + existing tests stay green. Quarters start at `fyStartMonth`, +3, +6,
 * +9 months. `fiscalYear` is the year the FY *started* (e.g. AU FY2026–27 → fiscalYear 2026;
 * NZ FY2026–27 starting 1 Apr 2026 → fiscalYear 2026).
 */
export function fiscalQuarter(
  date: Date,
  fyStartMonth: number = 7,
): { fiscalYear: number; quarter: number; label: string } {
  const startMonthIdx = fyStartMonth - 1; // 0–11
  const monthsSinceFYStart = (date.getUTCMonth() - startMonthIdx + 12) % 12;
  const quarter = Math.floor(monthsSinceFYStart / 3) + 1; // 1–4
  const fiscalYear =
    date.getUTCMonth() >= startMonthIdx ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return { fiscalYear, quarter, label: `${fiscalYear}-Q${quarter}` };
}

/**
 * Aggregate GST per financial-year quarter (the BAS / tax-runway view). Pure — no DB, no
 * time calls. Empty input → zeros + empty array. `gstCents` is `Math.abs`'d defensively.
 * `fyStartMonth` (1–12, default `7` = July) threads through to `fiscalQuarter` so the
 * quarter labels follow the workspace's financial-year anchor.
 */
export function summarizeGst(
  rows: readonly GstSummaryInput[],
  fyStartMonth: number = 7,
): GstSummary {
  let gstCollectedCents = 0;
  let gstPaidCents = 0;
  const quarterMap = new Map<string, GstQuarterPoint>();

  for (const row of rows) {
    const gst = Math.abs(row.gstCents);
    if (row.type === "income") gstCollectedCents += gst;
    else gstPaidCents += gst;

    const { fiscalYear, quarter, label } = fiscalQuarter(row.date, fyStartMonth);
    const existing = quarterMap.get(label);
    if (existing) {
      if (row.type === "income") existing.gstCollectedCents += gst;
      else existing.gstPaidCents += gst;
      existing.netGstCents = existing.gstCollectedCents - existing.gstPaidCents;
    } else {
      const collected = row.type === "income" ? gst : 0;
      const paid = row.type === "expense" ? gst : 0;
      quarterMap.set(label, {
        label,
        fiscalYear,
        quarter,
        gstCollectedCents: collected,
        gstPaidCents: paid,
        netGstCents: collected - paid,
      });
    }
  }

  const byQuarter = [...quarterMap.values()].sort(
    (a, b) => a.fiscalYear - b.fiscalYear || a.quarter - b.quarter,
  );

  return {
    gstCollectedCents,
    gstPaidCents,
    netGstCents: gstCollectedCents - gstPaidCents,
    byQuarter,
  };
}
