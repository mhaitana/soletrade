import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./format";

const NOW = new Date("2026-07-05T12:00:00Z");

function ago(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("formatRelativeTime", () => {
  it("returns 'just now' for very recent timestamps", () => {
    expect(formatRelativeTime(ago(10), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(44), NOW)).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(formatRelativeTime(ago(60), NOW)).toBe("1m ago");
    expect(formatRelativeTime(ago(180), NOW)).toBe("3m ago");
  });

  it("returns hours for under a day", () => {
    expect(formatRelativeTime(ago(60 * 60), NOW)).toBe("1h ago");
    expect(formatRelativeTime(ago(60 * 60 * 5), NOW)).toBe("5h ago");
  });

  it("returns days for under a week", () => {
    expect(formatRelativeTime(ago(60 * 60 * 24), NOW)).toBe("1d ago");
    expect(formatRelativeTime(ago(60 * 60 * 24 * 3), NOW)).toBe("3d ago");
  });

  it("falls back to an absolute date beyond a week", () => {
    const old = new Date("2026-06-01T00:00:00Z");
    const out = formatRelativeTime(old, NOW);
    // Exact locale formatting varies, but it must contain the day and short month.
    expect(out).toMatch(/Jun/);
    expect(out).toMatch(/1/);
  });

  it("handles future dates without throwing (negative diff)", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(() => formatRelativeTime(future, NOW)).not.toThrow();
  });
});
