import { describe, expect, it } from "vitest";
import { truncate } from "@/utils/truncate";

describe("truncate", () => {
  it("leaves text that already fits alone", () => {
    expect(truncate("receipt", 10)).toBe("receipt");
    expect(truncate("receipt", 7)).toBe("receipt");
  });

  it("cuts to the limit", () => {
    expect(truncate("How is my business doing", 6)).toBe("How is");
    expect(truncate("anything", 0)).toBe("");
  });

  it("never ends on half an emoji", () => {
    // "ab" + a two-unit emoji: cutting at 3 would keep only its first half.
    const text = "ab\u{1F9FE}cd";
    expect(truncate(text, 3)).toBe("ab");
    expect(truncate(text, 4)).toBe("ab\u{1F9FE}");
    // What is kept is always valid to send as JSON.
    for (let max = 0; max <= text.length; max++) {
      expect(() => encodeURIComponent(truncate(text, max))).not.toThrow();
    }
  });
});
