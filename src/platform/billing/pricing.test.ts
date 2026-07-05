import { describe, expect, it } from "vitest";
import {
  PRICING_CATALOG,
  canAddModuleOnTier,
  formatCents,
  nextModuleDiscountRate,
  priceSubscription,
  stackDiscountRate,
} from "./pricing";

describe("pricing engine", () => {
  describe("stackDiscountRate", () => {
    it("applies 0% to the first module and increasing discounts after", () => {
      expect(stackDiscountRate(0)).toBe(0);
      expect(stackDiscountRate(1)).toBe(0.1);
      expect(stackDiscountRate(2)).toBe(0.15);
      expect(stackDiscountRate(3)).toBe(0.2);
    });

    it("clamps beyond the configured rates to the last rate", () => {
      // Only 4 rates; the 5th+ module keeps the 20% rate.
      expect(stackDiscountRate(4)).toBe(0.2);
      expect(stackDiscountRate(99)).toBe(0.2);
    });

    it("returns 0 for non-positive positions", () => {
      expect(stackDiscountRate(-1)).toBe(0);
    });
  });

  describe("nextModuleDiscountRate", () => {
    it("returns the rate that would apply to the next-added module", () => {
      expect(nextModuleDiscountRate(0)).toBe(0); // 1st module, full price
      expect(nextModuleDiscountRate(1)).toBe(0.1); // 2nd module
      expect(nextModuleDiscountRate(2)).toBe(0.15); // 3rd
    });
  });

  describe("canAddModuleOnTier", () => {
    it("free tier cannot add modules", () => {
      expect(canAddModuleOnTier("free")).toBe(false);
    });
    it("pro tier can add modules", () => {
      expect(canAddModuleOnTier("pro")).toBe(true);
    });
  });

  describe("priceSubscription", () => {
    it("prices the free tier at zero (no modules, no anchor)", () => {
      const p = priceSubscription("free", []);
      expect(p.anchorCents).toBe(0);
      expect(p.modules).toHaveLength(0);
      expect(p.totalDiscountCents).toBe(0);
      expect(p.totalCents).toBe(0);
      expect(p.currency).toBe("AUD");
    });

    it("prices free tier with module keys at zero (policy gate is elsewhere)", () => {
      // The engine is pure arithmetic — free modulePriceCents is 0 so a module
      // listed on free prices at $0. canAddModuleOnTier gates the actual add.
      const p = priceSubscription("free", ["invoices"]);
      expect(p.totalCents).toBe(0);
      expect(p.modules[0]?.netCents).toBe(0);
    });

    it("prices Pro anchor only ($29) with no modules", () => {
      const p = priceSubscription("pro", []);
      expect(p.anchorCents).toBe(2900);
      expect(p.modules).toHaveLength(0);
      expect(p.totalCents).toBe(2900);
    });

    it("prices Pro + two modules with the 10% stack discount on the 2nd", () => {
      const p = priceSubscription("pro", ["invoices", "books"]);
      expect(p.anchorCents).toBe(2900);
      expect(p.modules).toHaveLength(2);
      expect(p.modules[0]).toMatchObject({
        key: "invoices",
        grossCents: 1500,
        discountCents: 0,
        netCents: 1500,
      });
      expect(p.modules[1]).toMatchObject({
        key: "books",
        grossCents: 1500,
        discountCents: 150,
        netCents: 1350,
      });
      expect(p.totalDiscountCents).toBe(150);
      expect(p.totalCents).toBe(2900 + 1500 + 1350);
    });

    it("prices Pro + three modules (10%/15% discounts on 2nd/3rd)", () => {
      const p = priceSubscription("pro", ["invoices", "books", "drive"]);
      expect(p.modules[0]?.netCents).toBe(1500);
      expect(p.modules[1]?.netCents).toBe(1350); // 10% off
      expect(p.modules[2]?.netCents).toBe(1275); // 15% off
      expect(p.totalDiscountCents).toBe(0 + 150 + 225);
      expect(p.totalCents).toBe(2900 + 1500 + 1350 + 1275);
    });

    it("prices all four modules (20% on the 4th+)", () => {
      const p = priceSubscription("pro", ["invoices", "books", "drive", "quotes"]);
      expect(p.modules[3]?.netCents).toBe(1200); // 20% off 1500
      expect(p.totalDiscountCents).toBe(0 + 150 + 225 + 300);
      expect(p.totalCents).toBe(2900 + 1500 + 1350 + 1275 + 1200);
    });

    it("preserves module order in the breakdown", () => {
      const p = priceSubscription("pro", ["quotes", "drive", "books", "invoices"]);
      expect(p.modules.map((m) => m.key)).toEqual(["quotes", "drive", "books", "invoices"]);
      // First module (quotes) gets 0%, second (drive) 10%, etc.
      expect(p.modules[0]?.discountCents).toBe(0);
      expect(p.modules[1]?.discountCents).toBe(150);
    });
  });

  describe("formatCents", () => {
    it("formats whole + fractional cents with a dollar sign", () => {
      expect(formatCents(2900)).toBe("$29.00");
      expect(formatCents(1500)).toBe("$15.00");
      expect(formatCents(1350)).toBe("$13.50");
      expect(formatCents(0)).toBe("$0.00");
    });
    it("prefixes a minus for negative amounts", () => {
      expect(formatCents(-1500)).toBe("-$15.00");
      expect(formatCents(-5)).toBe("-$0.05");
    });
  });

  describe("PRICING_CATALOG", () => {
    it("exposes the documented placeholder dollars (config-driven, editable)", () => {
      expect(PRICING_CATALOG.currency).toBe("AUD");
      expect(PRICING_CATALOG.tiers.pro.anchorCents).toBe(2900);
      expect(PRICING_CATALOG.tiers.pro.modulePriceCents).toBe(1500);
      expect(PRICING_CATALOG.tiers.free.anchorCents).toBe(0);
    });
  });
});
