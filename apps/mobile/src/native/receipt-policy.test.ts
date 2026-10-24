import { describe, expect, it } from "vitest";
import { receiptCurrency, receiptReviewFields } from "./receipt-policy";
describe("receipt currency review", () => {
  it("preserves the extracted original currency and amount without conversion", () => {
    expect(
      receiptReviewFields({
        merchant: "Merchant",
        totalCents: 12345,
        currency: "USD",
        date: "2026-10-25",
      }),
    ).toEqual({ description: "Merchant", amount: "123.45", currency: "USD", date: "2026-10-25" });
  });
  it("accepts canonical workspace currencies and rejects unsupported codes before copying amounts", () => {
    expect(receiptCurrency(" cad ")).toBe("CAD");
    expect(receiptCurrency("SGD")).toBe("SGD");
    expect(() => receiptReviewFields({ totalCents: 1200, currency: "XYZ" })).toThrow("supported");
    expect(() => receiptCurrency("AUDUSD")).toThrow("supported");
  });
});
