import { describe, expect, it } from "vitest";
import { formatDelta, percentDelta } from "@/utils/delta";

describe("shared delta - percentDelta", () => {
  it("returns none when both current and previous are zero", () => {
    expect(percentDelta(0, 0)).toEqual({ pct: null, kind: "none" });
  });

  it("returns new when previous is zero and current is positive", () => {
    expect(percentDelta(500, 0)).toEqual({ pct: null, kind: "new" });
  });

  it("returns flat (0%) when current equals previous (non-zero)", () => {
    expect(percentDelta(1000, 1000)).toEqual({ pct: 0, kind: "flat" });
  });

  it("returns up with a signed positive percentage, rounded to 0dp", () => {
    // 1100 vs 1000 → +10%.
    expect(percentDelta(1100, 1000)).toEqual({ pct: 10, kind: "up" });
    // 1234 vs 1000 → +23.4% → rounds to +23.
    expect(percentDelta(1234, 1000)).toEqual({ pct: 23, kind: "up" });
    // 1250 vs 1000 → +25% (half rounds up).
    expect(percentDelta(1250, 1000)).toEqual({ pct: 25, kind: "up" });
  });

  it("returns down with a signed negative percentage, rounded to 0dp", () => {
    // 900 vs 1000 → -10%.
    expect(percentDelta(900, 1000)).toEqual({ pct: -10, kind: "down" });
    // 876 vs 1000 → -12.4% → rounds to -12.
    expect(percentDelta(876, 1000)).toEqual({ pct: -12, kind: "down" });
  });

  it("treats a current that dropped to zero from non-zero previous as -100%", () => {
    expect(percentDelta(0, 1000)).toEqual({ pct: -100, kind: "down" });
  });

  it("handles a doubling as +100%", () => {
    expect(percentDelta(2000, 1000)).toEqual({ pct: 100, kind: "up" });
  });
});

describe("shared delta - formatDelta", () => {
  it("formats an up delta as '+N% vs last month'", () => {
    expect(formatDelta(percentDelta(1100, 1000))).toBe("+10% vs last month");
  });

  it("formats a down delta as 'N% vs last month' (the minus is in the pct)", () => {
    expect(formatDelta(percentDelta(900, 1000))).toBe("-10% vs last month");
  });

  it("formats a flat delta as 'No change vs last month'", () => {
    expect(formatDelta(percentDelta(1000, 1000))).toBe("No change vs last month");
  });

  it("formats a new delta as 'New this period'", () => {
    expect(formatDelta(percentDelta(500, 0))).toBe("New this period");
  });

  it("formats a none delta as empty string", () => {
    expect(formatDelta(percentDelta(0, 0))).toBe("");
  });

  it("accepts a custom period noun", () => {
    expect(formatDelta(percentDelta(1100, 1000), "last quarter")).toBe("+10% vs last quarter");
  });
});
