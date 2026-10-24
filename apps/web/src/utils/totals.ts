/**
 * Pure line-item totals math - shared by Invoices and Quotes (and any future
 * line-item document). No `server-only`, no DB - unit-testable in isolation,
 * mirroring `@/platform/billing/pricing.ts` purity. Extracted from
 * `@/modules/invoices/totals.ts` in Phase 8 so both modules share a single
 * source of truth (mirrors the Phase 7 `periods` extraction to `@/shared/utils`).
 *
 * Money is integer cents throughout. `quantity` is a decimal (hours, units); a line
 * item's `amountCents` is `round(quantity * unitPriceCents)` - half-up rounding so a
 * 2.5h line at $10.01/h (1001 cents) → 2502.5 → 2503 cents (round, not floor).
 */

export interface LineItemInput {
  quantity: number;
  unitPriceCents: number;
}

export interface LineItemTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** Options for {@link computeLineItemTotals}. */
export interface ComputeLineItemTotalsOptions {
  /**
   * When true, each line's `unitPriceCents` is treated as tax-inclusive (gross) and
   * the document `taxRate` is back-calculated from the total. `subtotalCents` is then
   * the ex-tax portion (`totalCents - taxCents`). Default `false` (tax added on top).
   */
  pricesIncludeTax?: boolean;
}

/** A single line item's amount, rounded to the nearest cent. */
export function lineItemAmountCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * Compute line-item totals from a list + a flat tax rate. `taxRate` is an integer
 * percent (10 = 10%); clamped to ≥ 0 so a stray negative never issues a negative
 * tax. Empty line items → all zeros.
 *
 * With `opts.pricesIncludeTax`, unit prices are gross: `totalCents` is the sum of
 * line amounts, `taxCents = round(totalCents * rate / (100 + rate))` (back-calculated
 * once on the total - matches the exclusive path's "round once on the sum" convention
 * and avoids per-line rounding drift), and `subtotalCents = totalCents - taxCents`.
 */
export function computeLineItemTotals(
  items: readonly LineItemInput[],
  taxRate: number,
  opts?: ComputeLineItemTotalsOptions,
): LineItemTotals {
  const lineSumCents = items.reduce(
    (sum, it) => sum + lineItemAmountCents(it.quantity, it.unitPriceCents),
    0,
  );
  const rate = Math.max(0, taxRate);

  if (opts?.pricesIncludeTax) {
    const totalCents = lineSumCents;
    // No tax to extract when the rate is 0 (avoid divide-by-zero); subtotal === total.
    const taxCents = rate > 0 ? Math.round((totalCents * rate) / (100 + rate)) : 0;
    return { subtotalCents: totalCents - taxCents, taxCents, totalCents };
  }

  const subtotalCents = lineSumCents;
  const taxCents = Math.round((subtotalCents * rate) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
