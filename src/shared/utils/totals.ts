/**
 * Pure line-item totals math — shared by Invoices and Quotes (and any future
 * line-item document). No `server-only`, no DB — unit-testable in isolation,
 * mirroring `@/platform/billing/pricing.ts` purity. Extracted from
 * `@/modules/invoices/totals.ts` in Phase 8 so both modules share a single
 * source of truth (mirrors the Phase 7 `periods` extraction to `@/shared/utils`).
 *
 * Money is integer cents throughout. `quantity` is a decimal (hours, units); a line
 * item's `amountCents` is `round(quantity * unitPriceCents)` — half-up rounding so a
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

/** A single line item's amount, rounded to the nearest cent. */
export function lineItemAmountCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * Compute line-item totals from a list + a flat tax rate. `taxRate` is an integer
 * percent (10 = 10%); clamped to ≥ 0 so a stray negative never issues a negative
 * tax. Empty line items → all zeros.
 */
export function computeLineItemTotals(
  items: readonly LineItemInput[],
  taxRate: number,
): LineItemTotals {
  const subtotalCents = items.reduce(
    (sum, it) => sum + lineItemAmountCents(it.quantity, it.unitPriceCents),
    0,
  );
  const rate = Math.max(0, taxRate);
  const taxCents = Math.round((subtotalCents * rate) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
