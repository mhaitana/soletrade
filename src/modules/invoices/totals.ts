/**
 * Pure invoice totals math (Phase 5). No `server-only`, no DB — unit-testable in
 * isolation, mirroring `@/platform/billing/pricing.ts` purity. The service layer
 * (`./index.ts`) calls these to denormalize totals onto the invoice row + line items.
 *
 * Money is integer cents throughout. `quantity` is a decimal (hours, units); a line
 * item's `amountCents` is `round(quantity * unitPriceCents)` — half-up rounding so a
 * 2.5h line at $10.01/h (1001 cents) → 2502.5 → 2503 cents (round, not floor).
 */

export interface LineItemInput {
  quantity: number;
  unitPriceCents: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** A single line item's amount, rounded to the nearest cent. */
export function lineItemAmountCents(quantity: number, unitPriceCents: number): number {
  return Math.round(quantity * unitPriceCents);
}

/**
 * Compute the invoice totals from its line items + a flat tax rate. `taxRate` is an
 * integer percent (10 = 10%); clamped to ≥ 0 so a stray negative never issues a
 * negative tax. Empty line items → all zeros.
 */
export function computeInvoiceTotals(
  items: readonly LineItemInput[],
  taxRate: number,
): InvoiceTotals {
  const subtotalCents = items.reduce(
    (sum, it) => sum + lineItemAmountCents(it.quantity, it.unitPriceCents),
    0,
  );
  const rate = Math.max(0, taxRate);
  const taxCents = Math.round((subtotalCents * rate) / 100);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}
