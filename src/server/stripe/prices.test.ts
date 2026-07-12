import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_KEYS } from "@/shared/constants/modules";

/**
 * Unit tests for the Stripe price-id accessors + the catalog↔price linkage.
 * No network, no real Stripe keys.
 *
 * The env module reads `process.env.STRIPE_PRICE_*` once at import via the shared
 * env parser (empty strings treated as unset). To test the unset-key path we
 * `vi.resetModules()` and re-import with the var removed, restoring afterwards.
 */

const ORIGINAL: Record<string, string | undefined> = {
  SECRET: process.env.STRIPE_SECRET_KEY,
};
// Snapshot every price env var so we can restore them after mutating.
for (const m of MODULE_KEYS) {
  for (const role of ["STANDALONE", "ADDON"] as const) {
    for (const interval of ["MONTHLY", "ANNUAL"] as const) {
      const key = `STRIPE_PRICE_${m.toUpperCase()}_${role}_${interval}`;
      ORIGINAL[key] = process.env[key];
    }
  }
}

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
  for (const m of MODULE_KEYS) {
    for (const role of ["standalone", "addon"] as const) {
      for (const interval of ["monthly", "annual"] as const) {
        process.env[
          `STRIPE_PRICE_${m.toUpperCase()}_${role.toUpperCase()}_${interval.toUpperCase()}`
        ] = `price_test_${m}_${role}_${interval}`;
      }
    }
  }
}

describe("getModulePriceId", () => {
  beforeEach(() => setAllPriceIds());
  afterEach(() => restoreEnv());

  it("returns the env price id for every (module × role × interval)", async () => {
    const { getModulePriceId } = await freshImport();
    expect(getModulePriceId("books", "standalone", "monthly")).toBe(
      "price_test_books_standalone_monthly",
    );
    expect(getModulePriceId("books", "standalone", "annual")).toBe(
      "price_test_books_standalone_annual",
    );
    expect(getModulePriceId("invoices", "addon", "monthly")).toBe(
      "price_test_invoices_addon_monthly",
    );
    expect(getModulePriceId("quotes", "addon", "annual")).toBe("price_test_quotes_addon_annual");
  });

  it("throws a clear boundary error when a price env var is unset", async () => {
    delete process.env.STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY;
    const { getModulePriceId } = await freshImport();
    expect(() => getModulePriceId("books", "standalone", "monthly")).toThrow(
      /STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY is not configured/,
    );
  });
});

describe("modulePriceCents (catalog ↔ price linkage, single source of truth)", () => {
  it("derives every amount from MODULE_PRICES (spec §10.1)", async () => {
    const { modulePriceCents } = await freshImport();
    expect(modulePriceCents("books", "standalone", "monthly")).toBe(900);
    expect(modulePriceCents("books", "standalone", "annual")).toBe(8100);
    expect(modulePriceCents("books", "addon", "monthly")).toBe(650);
    expect(modulePriceCents("books", "addon", "annual")).toBe(5850);
    expect(modulePriceCents("invoices", "standalone", "monthly")).toBe(600);
    expect(modulePriceCents("invoices", "addon", "annual")).toBe(3150);
  });
});

describe("buildPriceIdToModuleMap", () => {
  beforeEach(() => setAllPriceIds());
  afterEach(() => restoreEnv());

  it("maps every configured price id back to { moduleKey, role }", async () => {
    const { buildPriceIdToModuleMap } = await freshImport();
    const map = buildPriceIdToModuleMap();
    expect(map.get("price_test_books_standalone_monthly")).toEqual({
      moduleKey: "books",
      role: "standalone",
    });
    expect(map.get("price_test_invoices_addon_annual")).toEqual({
      moduleKey: "invoices",
      role: "addon",
    });
    expect(map.size).toBe(MODULE_KEYS.length * 2 * 2); // 4 modules × 2 roles × 2 intervals
  });

  it("omits prices whose env var is unset (defensive - partial config)", async () => {
    delete process.env.STRIPE_PRICE_BOOKS_ADDON_MONTHLY;
    const { buildPriceIdToModuleMap } = await freshImport();
    const map = buildPriceIdToModuleMap();
    expect(map.has("price_test_books_addon_monthly")).toBe(false);
    // Other books prices still mapped.
    expect(map.has("price_test_books_standalone_monthly")).toBe(true);
  });
});
