import { describe, expect, it } from "vitest";
import { DEFAULT_PERIOD, PERIODS, parsePeriod } from "./periods";

describe("books periods", () => {
  it("has a non-empty list with unique keys", () => {
    expect(PERIODS.length).toBeGreaterThan(0);
    const keys = PERIODS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the default period (year)", () => {
    expect(PERIODS.some((p) => p.key === "year")).toBe(true);
    expect(DEFAULT_PERIOD).toBe("year");
  });

  it("parsePeriod accepts known keys and falls back to the default otherwise", () => {
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("quarter")).toBe("quarter");
    expect(parsePeriod("year")).toBe("year");
    expect(parsePeriod("all")).toBe("all");
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("garbage")).toBe(DEFAULT_PERIOD);
  });
});
