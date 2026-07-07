import { describe, expect, it } from "vitest";
import { computeLineItemTotals, lineItemAmountCents } from "./totals";

describe("shared line-item totals — lineItemAmountCents", () => {
  it("rounds quantity × unit price to the nearest cent (half-up)", () => {
    // 2.5h × $10.01/h (1001 cents) = 2502.5 → 2503 (Math.round rounds .5 toward
    // +Infinity, so 2502.5 → 2503).
    expect(lineItemAmountCents(2.5, 1001)).toBe(2503);
  });

  it("handles integer quantities exactly", () => {
    expect(lineItemAmountCents(3, 5000)).toBe(15000);
  });

  it("handles fractional quantities (hours)", () => {
    // 0.25h × $80/h (8000 cents) = 2000
    expect(lineItemAmountCents(0.25, 8000)).toBe(2000);
  });

  it("zero quantity → zero amount", () => {
    expect(lineItemAmountCents(0, 9999)).toBe(0);
  });
});

describe("shared line-item totals — computeLineItemTotals", () => {
  it("sums line items into the subtotal with no tax when rate is 0", () => {
    const totals = computeLineItemTotals(
      [
        { quantity: 2, unitPriceCents: 5000 },
        { quantity: 1, unitPriceCents: 10000 },
      ],
      0,
    );
    expect(totals).toEqual({ subtotalCents: 20000, taxCents: 0, totalCents: 20000 });
  });

  it("applies a 10% GST rate, rounded to the nearest cent", () => {
    const totals = computeLineItemTotals([{ quantity: 1, unitPriceCents: 10001 }], 10);
    // subtotal 10001 → tax 1000.1 → round 1000 → total 11001
    expect(totals).toEqual({ subtotalCents: 10001, taxCents: 1000, totalCents: 11001 });
  });

  it("returns all zeros for an empty line-items array", () => {
    expect(computeLineItemTotals([], 10)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it("clamps a negative tax rate to 0 (never issues negative tax)", () => {
    const totals = computeLineItemTotals([{ quantity: 1, unitPriceCents: 5000 }], -10);
    expect(totals).toEqual({ subtotalCents: 5000, taxCents: 0, totalCents: 5000 });
  });

  it("sums fractional quantities across line items before taxing", () => {
    // 1.5h × 4000 + 2.5h × 6000 = 6000 + 15000 = 21000; 10% → 2100; total 23100
    const totals = computeLineItemTotals(
      [
        { quantity: 1.5, unitPriceCents: 4000 },
        { quantity: 2.5, unitPriceCents: 6000 },
      ],
      10,
    );
    expect(totals).toEqual({ subtotalCents: 21000, taxCents: 2100, totalCents: 23100 });
  });

  it("rounds each line item independently before summing (denormalized amounts)", () => {
    // Each line 2.5 × 1001 = 2502.5 → 2503; two lines → 5006 subtotal
    const totals = computeLineItemTotals(
      [
        { quantity: 2.5, unitPriceCents: 1001 },
        { quantity: 2.5, unitPriceCents: 1001 },
      ],
      0,
    );
    expect(totals.subtotalCents).toBe(5006);
  });
});

describe("shared line-item totals — computeLineItemTotals (pricesIncludeTax)", () => {
  it("back-calculates tax from a gross total at 10% ($100.00 inclusive → $9.09 tax, $90.91 ex-tax)", () => {
    const totals = computeLineItemTotals([{ quantity: 1, unitPriceCents: 10000 }], 10, {
      pricesIncludeTax: true,
    });
    // total 10000; tax = round(10000 * 10 / 110) = round(909.09) = 909; subtotal = 9091
    expect(totals).toEqual({ subtotalCents: 9091, taxCents: 909, totalCents: 10000 });
  });

  it("sums inclusive line amounts into the gross total, then back-calculates tax once on the sum", () => {
    // Two inclusive lines: 1 × $55.00 (5500) + 1 × $45.00 (4500) = 10000 gross.
    const totals = computeLineItemTotals(
      [
        { quantity: 1, unitPriceCents: 5500 },
        { quantity: 1, unitPriceCents: 4500 },
      ],
      10,
      { pricesIncludeTax: true },
    );
    expect(totals).toEqual({ subtotalCents: 9091, taxCents: 909, totalCents: 10000 });
  });

  it("inclusive flag with a 0% rate = no tax (subtotal equals total)", () => {
    const totals = computeLineItemTotals([{ quantity: 2, unitPriceCents: 5000 }], 0, {
      pricesIncludeTax: true,
    });
    expect(totals).toEqual({ subtotalCents: 10000, taxCents: 0, totalCents: 10000 });
  });

  it("defaults to tax-exclusive when opts is omitted (existing behaviour unchanged)", () => {
    const totals = computeLineItemTotals([{ quantity: 1, unitPriceCents: 10000 }], 10);
    expect(totals).toEqual({ subtotalCents: 10000, taxCents: 1000, totalCents: 11000 });
  });
});
