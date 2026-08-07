export interface PeriodIncome {
  currentCents: number;
  previousCents: number | null;
}

export interface ConsolidatedIncome extends PeriodIncome {
  /** Books is canonical when available; otherwise visible source modules are combined. */
  source: "books" | "modules" | null;
}

/**
 * Build one business-wide income total without double-counting mirrored transactions.
 * Books wins when installed because its ledger already contains Invoice and Drive mirrors;
 * without Books, paid Invoices and Drive earnings are independent and can be added safely.
 */
export function consolidateBusinessIncome(input: {
  books?: PeriodIncome | null;
  invoices?: PeriodIncome | null;
  drive?: PeriodIncome | null;
}): ConsolidatedIncome {
  if (input.books) return { ...input.books, source: "books" };

  const modules = [input.invoices, input.drive].filter(
    (item): item is PeriodIncome => item != null,
  );
  if (modules.length === 0) {
    return { currentCents: 0, previousCents: null, source: null };
  }

  return {
    currentCents: modules.reduce((sum, item) => sum + item.currentCents, 0),
    previousCents: modules.some((item) => item.previousCents !== null)
      ? modules.reduce((sum, item) => sum + (item.previousCents ?? 0), 0)
      : null,
    source: "modules",
  };
}
