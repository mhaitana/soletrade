import { describe, expect, it } from "vitest";
import {
  billingSetupPath,
  normalizePromotionCode,
  onboardingPath,
  parseSignupIntent,
  parseSignupModules,
} from "@/lib/domain/billing/signup-intent";

describe("signup intent", () => {
  it("parses, de-duplicates, and catalog-orders selected modules", () => {
    expect(parseSignupModules("books,invoices,books,unknown")).toEqual(["invoices", "books"]);
  });

  it("uses the trusted defaults for missing or wholly invalid selections", () => {
    expect(parseSignupModules(undefined)).toEqual(["books"]);
    expect(parseSignupModules("unknown")).toEqual(["books"]);
  });

  it("accepts promo and coupon link aliases and normalizes the code", () => {
    expect(
      parseSignupIntent({ modules: "quotes", interval: "annual", coupon: " launch25 " }),
    ).toEqual({ moduleKeys: ["quotes"], interval: "annual", promotionCode: "LAUNCH25" });
    expect(normalizePromotionCode("  ")).toBeUndefined();
  });

  it("serializes a safe continuation and billing return path", () => {
    const intent = {
      moduleKeys: ["books", "quotes"] as const,
      interval: "annual" as const,
      promotionCode: "SAVE-20",
    };
    expect(onboardingPath({ ...intent, moduleKeys: [...intent.moduleKeys] })).toBe(
      "/onboarding?modules=books%2Cquotes&interval=annual&promo=SAVE-20",
    );
    expect(billingSetupPath({ ...intent, moduleKeys: [...intent.moduleKeys] })).toBe(
      "/billing?modules=books%2Cquotes&interval=annual&promo=SAVE-20",
    );
  });
});
