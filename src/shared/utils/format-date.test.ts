import { describe, expect, it } from "vitest";
import { formatDate } from "./format-date";

describe("shared formatDate", () => {
  it("returns an em dash for null", () => {
    expect(formatDate(null)).toBe("-");
  });

  it("formats a date with year, short month, day in the host locale", () => {
    const d = new Date("2026-07-05T00:00:00Z");
    // The exact localized string varies by host locale, but it always contains the
    // year, a 3-letter month, and the day number - assert those substrings.
    const out = formatDate(d);
    expect(out).toContain("2026");
    expect(out).toContain("Jul");
    expect(out).toContain("5");
  });

  it("is not the em dash when given a real date", () => {
    expect(formatDate(new Date("2026-01-15T00:00:00Z"))).not.toBe("-");
  });
});
