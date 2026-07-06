import { describe, expect, it } from "vitest";
import { MODULE_KEYS } from "@/shared/constants/modules";
import {
  MODULE_PRICES,
  PRICING_CATALOG,
  STACK_DISCOUNT_CENTS,
  currentBillingPeriod,
  formatCents,
  moduleChargeCents,
  moduleRefundCents,
  priceSubscription,
  prorateChargeCents,
  prorateRefundCents,
  selectAnchor,
} from "./pricing";

describe("pricing engine — anchor/add-on model", () => {
  describe("selectAnchor", () => {
    it("returns null for an empty set (workspace is unbilled)", () => {
      expect(selectAnchor([])).toBeNull();
    });

    it("selects the highest-standalone module (Books > Quotes > Drive > Invoices)", () => {
      expect(selectAnchor(["invoices"])).toBe("invoices");
      expect(selectAnchor(["invoices", "books"])).toBe("books");
      expect(selectAnchor(["drive", "quotes"])).toBe("quotes");
      expect(selectAnchor(["invoices", "drive", "quotes"])).toBe("quotes");
      expect(selectAnchor([...MODULE_KEYS])).toBe("books");
    });

    it("breaks ties deterministically by MODULE_KEYS order", () => {
      // Order of input must not affect the result.
      expect(selectAnchor(["books", "quotes"])).toBe("books");
      expect(selectAnchor(["quotes", "books"])).toBe("books");
    });
  });

  describe("priceSubscription", () => {
    it("prices an empty set at zero (no anchor, no modules)", () => {
      const p = priceSubscription([], "monthly");
      expect(p.anchorKey).toBeNull();
      expect(p.modules).toHaveLength(0);
      expect(p.totalDiscountCents).toBe(0);
      expect(p.totalCents).toBe(0);
      expect(p.currency).toBe("AUD");
      expect(p.interval).toBe("monthly");
    });

    it("prices a single module at its standalone price (it is the anchor)", () => {
      const p = priceSubscription(["invoices"], "monthly");
      expect(p.anchorKey).toBe("invoices");
      expect(p.modules).toHaveLength(1);
      expect(p.modules[0]).toMatchObject({
        key: "invoices",
        role: "standalone",
        grossCents: 600,
        discountCents: 0,
        netCents: 600,
      });
      expect(p.totalCents).toBe(600);
    });

    it("prices Books (anchor@standalone) + Invoices (addon) monthly", () => {
      const p = priceSubscription(["books", "invoices"], "monthly");
      expect(p.anchorKey).toBe("books");
      expect(p.modules).toHaveLength(2);
      expect(p.modules[0]).toMatchObject({
        key: "books",
        role: "standalone",
        netCents: 900,
        discountCents: 0,
      });
      expect(p.modules[1]).toMatchObject({
        key: "invoices",
        role: "addon",
        grossCents: 600,
        netCents: 350,
        discountCents: 250,
      });
      expect(p.totalDiscountCents).toBe(250);
      expect(p.totalCents).toBe(900 + 350);
    });

    it("prices all four modules monthly = $22.50 (spec example)", () => {
      const p = priceSubscription(["books", "quotes", "drive", "invoices"], "monthly");
      expect(p.anchorKey).toBe("books");
      expect(p.modules.map((m) => m.key)).toEqual(["books", "quotes", "drive", "invoices"]);
      expect(p.modules.map((m) => m.netCents)).toEqual([900, 550, 450, 350]);
      expect(p.totalDiscountCents).toBe(250 * 3); // three add-ons each discounted $2.50
      expect(p.totalCents).toBe(2250);
    });

    it("prices all four modules annual = $202.50 (spec example)", () => {
      const p = priceSubscription(["books", "quotes", "drive", "invoices"], "annual");
      expect(p.anchorKey).toBe("books");
      expect(p.modules.map((m) => m.netCents)).toEqual([8100, 4950, 4050, 3150]);
      expect(p.totalDiscountCents).toBe(2250 * 3); // three add-ons each discounted $22.50
      expect(p.totalCents).toBe(20250);
    });

    it("reprices the new anchor when the highest-standalone module is added", () => {
      // Start with Invoices alone (anchor @ $6 standalone), then add Books.
      const before = priceSubscription(["invoices"], "monthly");
      expect(before.modules[0]?.role).toBe("standalone");
      const after = priceSubscription(["invoices", "books"], "monthly");
      expect(after.anchorKey).toBe("books");
      const books = after.modules.find((m) => m.key === "books")!;
      const invoices = after.modules.find((m) => m.key === "invoices")!;
      expect(books.role).toBe("standalone");
      expect(books.netCents).toBe(900);
      // Invoices demoted from anchor to add-on: $6 → $3.50.
      expect(invoices.role).toBe("addon");
      expect(invoices.netCents).toBe(350);
    });

    it("promotes the next-highest module to anchor when the anchor is removed", () => {
      // All four → remove Books → Quotes becomes the new anchor.
      const p = priceSubscription(["quotes", "drive", "invoices"], "monthly");
      expect(p.anchorKey).toBe("quotes");
      const quotes = p.modules.find((m) => m.key === "quotes")!;
      expect(quotes.role).toBe("standalone");
      expect(quotes.netCents).toBe(800);
      expect(p.modules.find((m) => m.key === "drive")?.netCents).toBe(450);
      expect(p.modules.find((m) => m.key === "invoices")?.netCents).toBe(350);
      expect(p.totalCents).toBe(800 + 450 + 350);
    });
  });

  describe("catalog invariants", () => {
    it("exposes the documented launch prices (spec §10.1)", () => {
      expect(MODULE_PRICES.books.standalone).toEqual({ monthly: 900, annual: 8100 });
      expect(MODULE_PRICES.books.addon).toEqual({ monthly: 650, annual: 5850 });
      expect(MODULE_PRICES.quotes.standalone).toEqual({ monthly: 800, annual: 7200 });
      expect(MODULE_PRICES.quotes.addon).toEqual({ monthly: 550, annual: 4950 });
      expect(MODULE_PRICES.drive.standalone).toEqual({ monthly: 700, annual: 6300 });
      expect(MODULE_PRICES.drive.addon).toEqual({ monthly: 450, annual: 4050 });
      expect(MODULE_PRICES.invoices.standalone).toEqual({ monthly: 600, annual: 5400 });
      expect(MODULE_PRICES.invoices.addon).toEqual({ monthly: 350, annual: 3150 });
      expect(PRICING_CATALOG.currency).toBe("AUD");
    });

    it("annual = 9 × monthly for every module and role (3 months free)", () => {
      for (const key of MODULE_KEYS) {
        const set = MODULE_PRICES[key];
        expect(set.standalone.annual).toBe(set.standalone.monthly * 9);
        expect(set.addon.annual).toBe(set.addon.monthly * 9);
      }
    });

    it("add-on discount is a flat $2.50/mo and $22.50/yr across every module", () => {
      for (const key of MODULE_KEYS) {
        const set = MODULE_PRICES[key];
        expect(set.standalone.monthly - set.addon.monthly).toBe(250);
        expect(set.standalone.annual - set.addon.annual).toBe(2250);
      }
      expect(STACK_DISCOUNT_CENTS.monthly).toBe(250);
      expect(STACK_DISCOUNT_CENTS.annual).toBe(2250);
    });
  });

  describe("formatCents", () => {
    it("formats whole + fractional cents with a dollar sign", () => {
      expect(formatCents(2250)).toBe("$22.50");
      expect(formatCents(900)).toBe("$9.00");
      expect(formatCents(350)).toBe("$3.50");
      expect(formatCents(0)).toBe("$0.00");
    });
    it("prefixes a minus for negative amounts", () => {
      expect(formatCents(-350)).toBe("-$3.50");
      expect(formatCents(-5)).toBe("-$0.05");
    });
  });
});

describe("proration refund (4c cancellation engine)", () => {
  const ANCHOR = new Date(Date.UTC(2026, 0, 1, 0, 0, 0)); // 2026-01-01T00:00:00Z

  describe("currentBillingPeriod", () => {
    it("returns the anchor period when now == anchor (monthly)", () => {
      const now = new Date(ANCHOR.getTime() + 5 * 86_400_000); // +5 days
      const { start, end } = currentBillingPeriod(ANCHOR, "monthly", now);
      expect(start.getTime()).toBe(ANCHOR.getTime());
      expect(end.getTime()).toBe(ANCHOR.getTime() + 30 * 86_400_000);
    });

    it("steps forward whole periods (monthly, 35 days in → start is day 30)", () => {
      const now = new Date(ANCHOR.getTime() + 35 * 86_400_000); // +35 days
      const { start, end } = currentBillingPeriod(ANCHOR, "monthly", now);
      expect(start.getTime()).toBe(ANCHOR.getTime() + 30 * 86_400_000);
      expect(end.getTime()).toBe(ANCHOR.getTime() + 60 * 86_400_000);
    });

    it("annual period is 365 days", () => {
      const now = new Date(ANCHOR.getTime() + 400 * 86_400_000); // ~13 months in
      const { start, end } = currentBillingPeriod(ANCHOR, "annual", now);
      expect(start.getTime()).toBe(ANCHOR.getTime() + 365 * 86_400_000);
      expect(end.getTime()).toBe(ANCHOR.getTime() + 2 * 365 * 86_400_000);
    });
  });

  describe("prorateRefundCents", () => {
    it("refunds the full net at the period start (remaining ≈ 100%)", () => {
      const now = new Date(ANCHOR.getTime() + 1_000); // 1s after anchor
      // 1s into a 30-day period → fraction ≈ 1.0 (clamped) → full refund
      expect(prorateRefundCents(900, "monthly", ANCHOR, now)).toBe(900);
    });

    it("refunds ~half at the midpoint of a monthly period", () => {
      const now = new Date(ANCHOR.getTime() + 15 * 86_400_000); // 15 of 30 days
      // 15/30 = 0.5 → 900 * 0.5 = 450
      expect(prorateRefundCents(900, "monthly", ANCHOR, now)).toBe(450);
    });

    it("refunds the next period's remaining fraction at a period boundary (billing in advance)", () => {
      // 31 days in = 1 day into period 2 (periods are contiguous). The customer paid
      // for period 2 at the boundary; cancelling 1 day in refunds 29/30 of net.
      const now = new Date(ANCHOR.getTime() + 31 * 86_400_000);
      expect(prorateRefundCents(900, "monthly", ANCHOR, now)).toBe(870); // 29/30 * 900
    });

    it("returns 0 when anchorBillingDate is null (legacy row)", () => {
      const now = new Date(ANCHOR.getTime() + 5 * 86_400_000);
      expect(prorateRefundCents(900, "monthly", null, now)).toBe(0);
    });

    it("returns 0 when netCents is non-positive", () => {
      const now = new Date(ANCHOR.getTime() + 5 * 86_400_000);
      expect(prorateRefundCents(0, "monthly", ANCHOR, now)).toBe(0);
      expect(prorateRefundCents(-100, "monthly", ANCHOR, now)).toBe(0);
    });

    it("annual: refunds a clean fraction (73 days in = 1/5 consumed → 4/5 refund)", () => {
      const now = new Date(ANCHOR.getTime() + 73 * 86_400_000); // 73 of 365 days
      // remaining = 292, fraction = 292/365 = 0.8 → 8100 * 0.8 = 6480
      expect(prorateRefundCents(8100, "annual", ANCHOR, now)).toBe(6480);
    });
  });

  describe("moduleRefundCents", () => {
    it("uses standalone price for the anchor module", () => {
      // 1s in → full refund. Books anchor standalone monthly = 900.
      const now = new Date(ANCHOR.getTime() + 1_000);
      expect(moduleRefundCents("books", ["books", "invoices"], "monthly", ANCHOR, now)).toBe(900);
    });

    it("uses add-on price for a non-anchor module", () => {
      // Invoices add-on monthly = 350.
      const now = new Date(ANCHOR.getTime() + 1_000);
      expect(moduleRefundCents("invoices", ["books", "invoices"], "monthly", ANCHOR, now)).toBe(
        350,
      );
    });

    it("returns 0 when the module is not in the active set", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      expect(moduleRefundCents("drive", ["books", "invoices"], "monthly", ANCHOR, now)).toBe(0);
    });

    it("returns 0 when anchorBillingDate is null", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      expect(moduleRefundCents("books", ["books"], "monthly", null, now)).toBe(0);
    });

    it("resolves the role dynamically as the active set changes (anchor promotion)", () => {
      // Drive alone is the anchor → standalone monthly = 700.
      const now = new Date(ANCHOR.getTime() + 15 * 86_400_000); // half period → 350
      expect(moduleRefundCents("drive", ["drive"], "monthly", ANCHOR, now)).toBe(350);
      // Drive alongside Books is an add-on → add-on monthly = 450 → half = 225
      expect(moduleRefundCents("drive", ["books", "drive"], "monthly", ANCHOR, now)).toBe(225);
    });
  });

  describe("prorateChargeCents", () => {
    it("returns 0 when anchorBillingDate is null (no active billing)", () => {
      expect(prorateChargeCents(8100, "annual", null, new Date())).toBe(0);
    });

    it("returns 0 when netCents is non-positive", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      expect(prorateChargeCents(0, "monthly", ANCHOR, now)).toBe(0);
      expect(prorateChargeCents(-100, "monthly", ANCHOR, now)).toBe(0);
    });

    it("charges the full-period net when added at the period start (fraction → 1)", () => {
      const now = new Date(ANCHOR.getTime() + 1_000); // 1s in → ~full period
      expect(prorateChargeCents(900, "monthly", ANCHOR, now)).toBe(900);
    });

    it("charges half the net at the half-period mark", () => {
      // 15 of 30 days elapsed → remaining 15/30 = 0.5 → 900 * 0.5 = 450
      const now = new Date(ANCHOR.getTime() + 15 * 86_400_000);
      expect(prorateChargeCents(900, "monthly", ANCHOR, now)).toBe(450);
    });

    it("matches the spec example: $40.50 addon at 50% remaining → $20.25", () => {
      // $40.50 = 4050 cents (Drive annual addon). Annual period = 365 days.
      // 50% remaining → 4050 * 0.5 = 2025 ($20.25)
      const now = new Date(ANCHOR.getTime() + Math.round(365 * 86_400_000 * 0.5));
      expect(prorateChargeCents(4050, "annual", ANCHOR, now)).toBe(2025);
    });

    it("rolls into the next billing period (charges its remaining, not 0)", () => {
      // 31 days in → current period is [30, 60], remaining 29/30 → 900 * 29/30 = 870.
      // `currentBillingPeriod` floors to the period containing `now`, so a now past
      // the first period lands in the next one (the charge never collapses to 0).
      const now = new Date(ANCHOR.getTime() + 31 * 86_400_000);
      expect(prorateChargeCents(900, "monthly", ANCHOR, now)).toBe(870);
    });
  });

  describe("moduleChargeCents", () => {
    it("charges standalone when the new module becomes the anchor", () => {
      // Adding Books to {invoices} → Books becomes anchor → standalone monthly 900.
      // 1s in → full period → 900.
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = moduleChargeCents("books", ["invoices"], "monthly", ANCHOR, now);
      expect(res.role).toBe("standalone");
      expect(res.becomesAnchor).toBe(true);
      expect(res.netCents).toBe(900);
      expect(res.proratedCents).toBe(900);
    });

    it("charges add-on when the new module stays beneath the existing anchor", () => {
      // Adding Invoices to {books} → Invoices is an add-on → add-on monthly 350.
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = moduleChargeCents("invoices", ["books"], "monthly", ANCHOR, now);
      expect(res.role).toBe("addon");
      expect(res.becomesAnchor).toBe(false);
      expect(res.netCents).toBe(350);
      expect(res.proratedCents).toBe(350);
    });

    it("prorates the charge for the remaining partial period (50% → half)", () => {
      // Adding Drive to {books} mid-cycle → add-on monthly 450, half remaining → 225.
      const now = new Date(ANCHOR.getTime() + 15 * 86_400_000);
      const res = moduleChargeCents("drive", ["books"], "monthly", ANCHOR, now);
      expect(res.role).toBe("addon");
      expect(res.becomesAnchor).toBe(false);
      expect(res.netCents).toBe(450);
      expect(res.proratedCents).toBe(225);
    });

    it("returns 0 proration when the module is already in the active set", () => {
      const now = new Date(ANCHOR.getTime() + 1_000);
      const res = moduleChargeCents("books", ["books"], "monthly", ANCHOR, now);
      expect(res.proratedCents).toBe(0);
      // role/becomesAnchor still resolved from the resulting set.
      expect(res.becomesAnchor).toBe(true);
      expect(res.role).toBe("standalone");
    });

    it("returns 0 proration when there is no anchor date (no active billing)", () => {
      const now = new Date();
      const res = moduleChargeCents("books", [], "monthly", null, now);
      expect(res.proratedCents).toBe(0);
      // becomesAnchor is still true (only module in the resulting set), net resolved.
      expect(res.becomesAnchor).toBe(true);
      expect(res.netCents).toBe(900);
    });
  });
});
