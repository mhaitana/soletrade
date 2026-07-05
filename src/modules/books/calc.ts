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

import type { BookType } from "@/server/db/schema/enums";

/** A transaction reduced to the fields `summarizeTransactions` needs. */
export interface TransactionSummaryInput {
  type: BookType;
  /** Integer cents, expected positive. `Math.abs` is applied defensively. */
  amountCents: number;
  /** The transaction's calendar date — drives the monthly grouping. */
  date: Date;
  /** Category slug (catalog validation lives at the action boundary). */
  category: string;
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
  let count = 0;

  // Per type|category aggregation. Insertion order is tracked so the final sort is stable
  // within a type when amounts tie.
  const catMap = new Map<string, CategoryBreakdown>();
  // Per month aggregation, keyed "YYYY-MM".
  const monthMap = new Map<string, MonthlyNetPoint>();

  for (const row of rows) {
    const amount = Math.abs(row.amountCents);
    count += 1;
    if (row.type === "income") {
      incomeCents += amount;
    } else {
      expenseCents += amount;
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
    count,
    byCategory,
    monthly,
  };
}
