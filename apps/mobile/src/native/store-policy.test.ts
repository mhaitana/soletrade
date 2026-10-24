import { describe, expect, it } from "vitest";
import {
  googlePurchasePayload,
  googleChangePreview,
  verifiedPurchaseMessage,
  canFinishVerifiedPurchase,
  type GoogleReplacement,
} from "./store-policy";
const replacement: GoogleReplacement = {
  purchaseToken: "trusted-old-token",
  productId: "business_books_drive",
  basePlanId: "monthly",
  modules: ["books", "drive"],
};
const base = {
  accountHash: "account-hash",
  profileHash: "profile-hash",
  offerToken: "actual-store-offer",
  billing: { provider: "google" as const, status: "active", paidThrough: "2099-01-01T00:00:00Z" },
  replacement,
  availablePurchases: [
    {
      productId: replacement.productId,
      purchaseToken: replacement.purchaseToken,
      purchaseState: "purchased",
      obfuscatedAccountIdAndroid: "account-hash",
      obfuscatedProfileIdAndroid: "profile-hash",
    },
  ],
};
describe("Google native subscription replacement", () => {
  it("passes the trusted old purchase token and preferred product-level replacement params on upgrades", () => {
    const result = googlePurchasePayload({
      ...base,
      target: {
        productId: "business_books_drive_invoices",
        basePlanId: "monthly",
        modules: ["books", "drive", "invoices"],
      },
    });
    expect(result.google).toMatchObject({
      purchaseToken: "trusted-old-token",
      subscriptionProductReplacementParams: {
        oldProductId: "business_books_drive",
        replacementMode: "with-time-proration",
      },
      subscriptionOffers: [
        { sku: "business_books_drive_invoices", offerToken: "actual-store-offer" },
      ],
    });
    expect(result.google).not.toHaveProperty("replacementMode");
    expect(result.timing).toBe("immediate");
  });
  it("defers pure module downgrades and clearly previews mixed whole-bundle changes", () => {
    const downgrade = googlePurchasePayload({
      ...base,
      target: { productId: "business_books", basePlanId: "monthly", modules: ["books"] },
    });
    expect(downgrade.google.subscriptionProductReplacementParams?.replacementMode).toBe("deferred");
    expect(downgrade.timing).toBe("renewal");
    const preview = googleChangePreview(replacement, {
      productId: "business_books_invoices",
      basePlanId: "monthly",
      modules: ["books", "invoices"],
    });
    expect(preview).toContain("Add invoices");
    expect(preview).toContain("remove drive immediately");
  });
  it("uses WITHOUT_PRORATION for same-product interval changes and rejects buying the current plan again", () => {
    const result = googlePurchasePayload({
      ...base,
      target: {
        productId: replacement.productId,
        basePlanId: "annual",
        modules: replacement.modules,
      },
    });
    expect(result.google.subscriptionProductReplacementParams?.replacementMode).toBe(
      "without-proration",
    );
    expect(result.timing).toBe("interval");
    expect(() =>
      googlePurchasePayload({
        ...base,
        target: {
          productId: replacement.productId,
          basePlanId: replacement.basePlanId,
          modules: replacement.modules,
        },
      }),
    ).toThrow("already selected");
  });
  it("rejects missing trusted current token before any payment sheet and never selects another available purchase", () => {
    const target = {
      productId: "business_books",
      basePlanId: "monthly",
      modules: ["books"] as "books"[],
    };
    expect(() => googlePurchasePayload({ ...base, target, replacement: null })).toThrow("Restore");
    expect(() =>
      googlePurchasePayload({
        ...base,
        target,
        availablePurchases: [
          { ...base.availablePurchases[0], obfuscatedProfileIdAndroid: "another-workspace" },
        ],
      }),
    ).toThrow("workspace");
    const result = googlePurchasePayload({
      ...base,
      target,
      availablePurchases: [
        {
          ...base.availablePurchases[0],
          purchaseToken: "unrelated-newer-token",
          productId: "other",
        },
      ],
    });
    expect(result.google.purchaseToken).toBe(replacement.purchaseToken);
  });
  it("starts a first purchase without replacement fields and never reports deferred modules as active prematurely", () => {
    const result = googlePurchasePayload({
      ...base,
      billing: { provider: null, status: "none", paidThrough: null },
      replacement: null,
      availablePurchases: [],
      target: { productId: "business_books", basePlanId: "monthly", modules: ["books"] },
    });
    expect(result.google).not.toHaveProperty("purchaseToken");
    expect(result.google).not.toHaveProperty("subscriptionProductReplacementParams");
    expect(verifiedPurchaseMessage("renewal", ["books"], ["books", "drive"], null)).toContain(
      "not yet confirmed",
    );
    expect(verifiedPurchaseMessage("renewal", ["books"], ["books", "drive"], ["books"])).toContain(
      "scheduled",
    );
    expect(verifiedPurchaseMessage("immediate", ["books", "invoices"], ["books"], null)).toContain(
      "not yet confirmed",
    );
  });
});

it("finishes trusted canceled-but-paid coverage while retaining pending or expired purchases unfinished", () => {
  expect(
    canFinishVerifiedPurchase(
      { provider: "google", status: "canceled", paidThrough: "2099-01-01T00:00:00Z" },
      0,
    ),
  ).toBe(true);
  expect(
    canFinishVerifiedPurchase(
      { provider: "google", status: "canceled", paidThrough: "2000-01-01T00:00:00Z" },
      Date.parse("2026-10-25T00:00:00Z"),
    ),
  ).toBe(false);
  expect(
    canFinishVerifiedPurchase(
      { provider: "google", status: "pending", paidThrough: "2099-01-01T00:00:00Z" },
      0,
    ),
  ).toBe(false);
});
