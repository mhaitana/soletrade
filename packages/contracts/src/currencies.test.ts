import { describe, expect, it } from "vitest";
import { isSupportedCurrency } from "./currencies";

describe("currency validation", () => {
  it.each(["AUD", "USD", "EUR", "GBP", "NZD", "CAD", "SGD"])(
    "accepts %s for cross-client records",
    (code) => {
      expect(isSupportedCurrency(code)).toBe(true);
    },
  );
  it.each(["", "aud", "BTC", " AUD "])("rejects unsupported or unnormalized values: %s", (code) => {
    expect(isSupportedCurrency(code)).toBe(false);
  });
});
