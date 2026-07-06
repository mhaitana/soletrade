import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIOD,
  PERIODS,
  parsePeriod,
  periodRange,
  previousPeriodRange,
  startOfWeek,
} from "./periods";

describe("shared periods", () => {
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
    expect(parsePeriod("week")).toBe("week");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("quarter")).toBe("quarter");
    expect(parsePeriod("year")).toBe("year");
    expect(parsePeriod("all")).toBe("all");
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("garbage")).toBe(DEFAULT_PERIOD);
  });
});

describe("shared periods — startOfWeek", () => {
  it("rolls back to Monday (Australian week starts Monday)", () => {
    // 2026-07-08 is a Wednesday → Monday is 2026-07-06.
    expect(startOfWeek(new Date("2026-07-08T10:30:00Z"))).toEqual(new Date("2026-07-06T00:00:00Z"));
  });

  it("keeps Monday unchanged", () => {
    expect(startOfWeek(new Date("2026-07-06T15:00:00Z"))).toEqual(new Date("2026-07-06T00:00:00Z"));
  });

  it("rolls Sunday back to the previous Monday", () => {
    // 2026-07-12 is a Sunday → Monday is 2026-07-06.
    expect(startOfWeek(new Date("2026-07-12T00:00:00Z"))).toEqual(new Date("2026-07-06T00:00:00Z"));
  });
});

describe("shared periods — periodRange", () => {
  // A fixed "now" so the assertions are deterministic: 2026-07-05 10:30 UTC.
  const now = new Date("2026-07-05T10:30:00Z");

  it("returns start=null for 'all' (no lower bound)", () => {
    const r = periodRange("all", now);
    expect(r.start).toBeNull();
    expect(r.end).toBe(now);
  });

  it("month → start is the first of the current month, UTC midnight", () => {
    const r = periodRange("month", now);
    expect(r.start).toEqual(new Date("2026-07-01T00:00:00Z"));
    expect(r.end).toBe(now);
  });

  it("quarter → start is the first day of the current quarter (Q3 → Jul 1)", () => {
    const r = periodRange("quarter", now);
    expect(r.start).toEqual(new Date("2026-07-01T00:00:00Z"));
  });

  it("quarter → Q1 (Feb) → Jan 1, Q2 (May) → Apr 1, Q4 (Nov) → Oct 1", () => {
    expect(periodRange("quarter", new Date("2026-02-15T00:00:00Z")).start).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(periodRange("quarter", new Date("2026-05-15T00:00:00Z")).start).toEqual(
      new Date("2026-04-01T00:00:00Z"),
    );
    expect(periodRange("quarter", new Date("2026-11-15T00:00:00Z")).start).toEqual(
      new Date("2026-10-01T00:00:00Z"),
    );
  });

  it("year → start is Jan 1 of the current year, UTC midnight", () => {
    const r = periodRange("year", now);
    expect(r.start).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("week → start is the Monday of the current week, UTC midnight", () => {
    // 2026-07-05 is a Sunday → Monday of that week is 2026-06-29.
    const r = periodRange("week", now);
    expect(r.start).toEqual(new Date("2026-06-29T00:00:00Z"));
    expect(r.end).toBe(now);
  });
});

describe("shared periods — previousPeriodRange", () => {
  const now = new Date("2026-07-05T10:30:00Z");

  it("returns null for 'all' (no meaningful previous period)", () => {
    expect(previousPeriodRange("all", now)).toBeNull();
  });

  it("month → previous calendar month, same-length window shifted back", () => {
    // now = July 5 10:30 → current = [Jul 1 00:00, Jul 5 10:30]
    // previous = [Jun 1 00:00, Jun 5 10:30]
    const r = previousPeriodRange("month", now)!;
    expect(r.start).toEqual(new Date("2026-06-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2026-06-05T10:30:00Z"));
  });

  it("quarter → previous quarter, same-length window shifted back 3 months", () => {
    // now = July 5 (Q3) → current start = Jul 1 → previous start = Apr 1; previous end = Apr 5 10:30.
    const r = previousPeriodRange("quarter", now)!;
    expect(r.start).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2026-04-05T10:30:00Z"));
  });

  it("year → previous year, same-length window shifted back 1 year", () => {
    const r = previousPeriodRange("year", now)!;
    expect(r.start).toEqual(new Date("2025-01-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2025-07-05T10:30:00Z"));
  });

  it("rolls the year back when the previous month is in the prior year", () => {
    // now = Jan 5 2026 → previous month = Dec 1 2025 – Dec 5 2025.
    const r = previousPeriodRange("month", new Date("2026-01-05T10:30:00Z"))!;
    expect(r.start).toEqual(new Date("2025-12-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2025-12-05T10:30:00Z"));
  });

  it("week → previous 7-day window shifted back one week", () => {
    // now = July 5 (Sun) 10:30 → current week start = Jun 29; previous start = Jun 22; previous end = Jun 28 10:30.
    const r = previousPeriodRange("week", now)!;
    expect(r.start).toEqual(new Date("2026-06-22T00:00:00Z"));
    expect(r.end).toEqual(new Date("2026-06-28T10:30:00Z"));
  });
});
