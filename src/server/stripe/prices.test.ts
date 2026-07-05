import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the Stripe price-id accessors + the catalog↔price linkage.
 * No network, no real Stripe keys.
 *
 * The env module reads `process.env.STRIPE_PRICE_*` once at import via the shared
 * env parser (empty strings treated as unset). To test the unset-key path we
 * `vi.resetModules()` and re-import with the var removed, restoring afterwards.
 */

const ORIGINAL = {
  ANCHOR: process.env.STRIPE_PRICE_ANCHOR,
  POS_0: process.env.STRIPE_PRICE_MODULE_POS_0,
  POS_1: process.env.STRIPE_PRICE_MODULE_POS_1,
  POS_2: process.env.STRIPE_PRICE_MODULE_POS_2,
  POS_3: process.env.STRIPE_PRICE_MODULE_POS_3,
  SECRET: process.env.STRIPE_SECRET_KEY,
};

async function freshImport() {
  vi.resetModules();
  return (await import("./prices")) as typeof import("./prices");
}

function restoreEnv() {
  for (const [key, val] of Object.entries(ORIGINAL)) {
    if (val === undefined) delete process.env[key];
    else (process.env as Record<string, string | undefined>)[key] = val;
  }
}

function setAllPriceIds() {
  process.env.STRIPE_PRICE_ANCHOR = "price_test_anchor";
  process.env.STRIPE_PRICE_MODULE_POS_0 = "price_test_m0";
  process.env.STRIPE_PRICE_MODULE_POS_1 = "price_test_m1";
  process.env.STRIPE_PRICE_MODULE_POS_2 = "price_test_m2";
  process.env.STRIPE_PRICE_MODULE_POS_3 = "price_test_m3";
}

describe("getModulePriceId", () => {
  beforeEach(() => setAllPriceIds());
  afterEach(() => restoreEnv());

  it("returns the env price id for positions 0..3", async () => {
    const { getModulePriceId } = await freshImport();
    expect(getModulePriceId(0)).toBe("price_test_m0");
    expect(getModulePriceId(1)).toBe("price_test_m1");
    expect(getModulePriceId(2)).toBe("price_test_m2");
    expect(getModulePriceId(3)).toBe("price_test_m3");
  });

  it("clamps positions above 3 to the deepest-discount Price", async () => {
    const { getModulePriceId } = await freshImport();
    expect(getModulePriceId(5)).toBe("price_test_m3");
    expect(getModulePriceId(99)).toBe("price_test_m3");
  });

  it("clamps negative positions to 0", async () => {
    const { getModulePriceId } = await freshImport();
    expect(getModulePriceId(-1)).toBe("price_test_m0");
  });

  it("throws a clear boundary error when STRIPE_PRICE_MODULE_POS_0 is unset", async () => {
    delete process.env.STRIPE_PRICE_MODULE_POS_0;
    const { getModulePriceId } = await freshImport();
    expect(() => getModulePriceId(0)).toThrow(/STRIPE_PRICE_MODULE_POS_0 is not configured/);
  });
});

describe("getProAnchorPriceId", () => {
  afterEach(() => restoreEnv());

  it("returns the anchor env id when set", async () => {
    process.env.STRIPE_PRICE_ANCHOR = "price_test_anchor";
    const { getProAnchorPriceId } = await freshImport();
    expect(getProAnchorPriceId()).toBe("price_test_anchor");
  });

  it("throws a clear boundary error when STRIPE_PRICE_ANCHOR is unset", async () => {
    delete process.env.STRIPE_PRICE_ANCHOR;
    const { getProAnchorPriceId } = await freshImport();
    expect(() => getProAnchorPriceId()).toThrow(/STRIPE_PRICE_ANCHOR is not configured/);
  });
});

describe("modulePriceCentsForPosition (catalog ↔ price linkage)", () => {
  // Pure derivation from PRICING_CATALOG — no env needed.
  it("derives the per-position amounts from PRICING_CATALOG (single source of truth)", async () => {
    const { modulePriceCentsForPosition } = await freshImport();
    expect(modulePriceCentsForPosition(0)).toBe(1500); // 0% off
    expect(modulePriceCentsForPosition(1)).toBe(1350); // 10% off
    expect(modulePriceCentsForPosition(2)).toBe(1275); // 15% off
    expect(modulePriceCentsForPosition(3)).toBe(1200); // 20% off
  });

  it("clamps beyond position 3 to the 20%-off amount", async () => {
    const { modulePriceCentsForPosition } = await freshImport();
    expect(modulePriceCentsForPosition(7)).toBe(1200);
    expect(modulePriceCentsForPosition(-2)).toBe(1500);
  });
});
