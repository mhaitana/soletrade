import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIOD,
  PERIODS,
  parsePeriod,
  periodRange,
  previousPeriodRange,
  startOfWeek,
  fiscalYearStart,
  fiscalQuarterStart,
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

  it("labels 'year' as 'Current FY' and includes a 'Calendar year' option", () => {
    const year = PERIODS.find((p) => p.key === "year");
    expect(year?.label).toBe("Current FY");
    const calendar = PERIODS.find((p) => p.key === "calendar");
    expect(calendar?.label).toBe("Calendar year");
  });

  it("parsePeriod accepts known keys and falls back to the default otherwise", () => {
    expect(parsePeriod("week")).toBe("week");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("quarter")).toBe("quarter");
    expect(parsePeriod("year")).toBe("year");
    expect(parsePeriod("calendar")).toBe("calendar");
    expect(parsePeriod("all")).toBe("all");
    expect(parsePeriod(undefined)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod("garbage")).toBe(DEFAULT_PERIOD);
  });
});

describe("shared periods - startOfWeek", () => {
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

describe("shared periods - periodRange", () => {
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

  it("calendar → start is Jan 1 of now's year, UTC midnight (FY-agnostic)", () => {
    const r = periodRange("calendar", now);
    expect(r.start).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(r.end).toBe(now);
    // FY anchor has no effect on the calendar-year window.
    expect(periodRange("calendar", now, 7).start).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(periodRange("calendar", now, 4).start).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("week → start is the Monday of the current week, UTC midnight", () => {
    // 2026-07-05 is a Sunday → Monday of that week is 2026-06-29.
    const r = periodRange("week", now);
    expect(r.start).toEqual(new Date("2026-06-29T00:00:00Z"));
    expect(r.end).toBe(now);
  });
});

describe("shared periods - previousPeriodRange", () => {
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

  it("calendar → previous calendar year, same-length window shifted back 1 year", () => {
    // now = July 5 2026 → current = [Jan 1 2026, Jul 5 2026]; previous = [Jan 1 2025, Jul 5 2025].
    const r = previousPeriodRange("calendar", now)!;
    expect(r.start).toEqual(new Date("2025-01-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2025-07-05T10:30:00Z"));
    // FY-agnostic: the anchor doesn't change the calendar-year previous window.
    expect(previousPeriodRange("calendar", now, 7)?.start).toEqual(
      new Date("2025-01-01T00:00:00Z"),
    );
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

// --- Financial-year anchoring (fyStartMonth) ---------------------------------
// The default fyStartMonth is 1 (January = calendar year), which preserves today's
// behaviour for unthreaded callers (covered by the blocks above). These tests exercise the
// fiscal reanchor when a workspace's configured fyStartMonth is threaded through.

describe("shared periods - fiscalYearStart", () => {
  it("AU (fyStartMonth=7): Jul–Dec is in the FY that started this year", () => {
    expect(fiscalYearStart(new Date("2026-07-05T10:30:00Z"), 7)).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(fiscalYearStart(new Date("2026-12-31T23:59:00Z"), 7)).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
  });

  it("AU (fyStartMonth=7): Jan–Jun rolls back to the prior year's FY start", () => {
    expect(fiscalYearStart(new Date("2026-01-05T10:30:00Z"), 7)).toEqual(
      new Date("2025-07-01T00:00:00Z"),
    );
    expect(fiscalYearStart(new Date("2026-06-30T23:59:00Z"), 7)).toEqual(
      new Date("2025-07-01T00:00:00Z"),
    );
  });

  it("NZ (fyStartMonth=4): Apr–Mar FY - Apr starts this year, Feb rolls back", () => {
    expect(fiscalYearStart(new Date("2026-04-01T00:00:00Z"), 4)).toEqual(
      new Date("2026-04-01T00:00:00Z"),
    );
    expect(fiscalYearStart(new Date("2027-02-15T00:00:00Z"), 4)).toEqual(
      new Date("2026-04-01T00:00:00Z"),
    );
  });

  it("January (fyStartMonth=1) reduces to the calendar year", () => {
    expect(fiscalYearStart(new Date("2026-07-05T10:30:00Z"), 1)).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(fiscalYearStart(new Date("2026-01-01T00:00:00Z"), 1)).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
  });
});

describe("shared periods - fiscalQuarterStart", () => {
  it("AU (fyStartMonth=7): Q1=Jul, Q2=Oct, Q3=Jan, Q4=Apr", () => {
    expect(fiscalQuarterStart(new Date("2026-08-15T00:00:00Z"), 7)).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2026-11-15T00:00:00Z"), 7)).toEqual(
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2027-02-15T00:00:00Z"), 7)).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2027-05-15T00:00:00Z"), 7)).toEqual(
      new Date("2027-04-01T00:00:00Z"),
    );
  });

  it("NZ (fyStartMonth=4): Q1=Apr, Q2=Jul, Q3=Oct, Q4=Jan", () => {
    expect(fiscalQuarterStart(new Date("2026-05-15T00:00:00Z"), 4)).toEqual(
      new Date("2026-04-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2026-08-15T00:00:00Z"), 4)).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2026-11-15T00:00:00Z"), 4)).toEqual(
      new Date("2026-10-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2027-02-15T00:00:00Z"), 4)).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
  });

  it("January (fyStartMonth=1) = calendar quarters (Jan/Apr/Jul/Oct)", () => {
    expect(fiscalQuarterStart(new Date("2026-02-15T00:00:00Z"), 1)).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(fiscalQuarterStart(new Date("2026-07-05T00:00:00Z"), 1)).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
  });
});

describe("shared periods - periodRange with fyStartMonth", () => {
  it("'year' reanchors to the financial year (AU July)", () => {
    // Jul 5 2026 → FY2026-27 started Jul 1 2026.
    expect(periodRange("year", new Date("2026-07-05T10:30:00Z"), 7).start).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
    // Feb 5 2027 → still in FY2026-27 (started Jul 1 2026).
    expect(periodRange("year", new Date("2027-02-05T10:30:00Z"), 7).start).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
  });

  it("'year' reanchors to the NZ financial year (April)", () => {
    expect(periodRange("year", new Date("2026-07-05T10:30:00Z"), 4).start).toEqual(
      new Date("2026-04-01T00:00:00Z"),
    );
    expect(periodRange("year", new Date("2027-02-05T10:30:00Z"), 4).start).toEqual(
      new Date("2026-04-01T00:00:00Z"),
    );
  });

  it("'year' with January anchor = calendar year (no-op vs default)", () => {
    expect(periodRange("year", new Date("2026-07-05T10:30:00Z"), 1).start).toEqual(
      new Date("2026-01-01T00:00:00Z"),
    );
  });

  it("'quarter' reanchors to the financial quarter (AU July: Feb → Jan 1)", () => {
    // Feb 2027 is in AU fiscal Q3 (Jan–Mar) → starts Jan 1 2027.
    expect(periodRange("quarter", new Date("2027-02-15T00:00:00Z"), 7).start).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
  });

  it("'quarter' reanchors to the NZ financial quarter (Aug → Jul 1)", () => {
    // Aug 2026 is in NZ fiscal Q2 (Jul–Sep) → starts Jul 1 2026.
    expect(periodRange("quarter", new Date("2026-08-15T00:00:00Z"), 4).start).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
  });

  it("'month' is unaffected by the FY anchor", () => {
    expect(periodRange("month", new Date("2026-07-05T10:30:00Z"), 7).start).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
    expect(periodRange("month", new Date("2026-07-05T10:30:00Z"), 4).start).toEqual(
      new Date("2026-07-01T00:00:00Z"),
    );
  });
});

describe("shared periods - previousPeriodRange with fyStartMonth", () => {
  it("'year' shifts the fiscal window back 12 months (AU July)", () => {
    // now = Jul 5 2026 → current FY start Jul 1 2026; previous = Jul 1 2025 – Jul 5 2025.
    const r = previousPeriodRange("year", new Date("2026-07-05T10:30:00Z"), 7)!;
    expect(r.start).toEqual(new Date("2025-07-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2025-07-05T10:30:00Z"));
  });

  it("'year' shifts the NZ fiscal window back 12 months (April)", () => {
    // now = Jul 5 2026 → current FY start Apr 1 2026; previous = Apr 1 2025 – Jul 5 2025.
    const r = previousPeriodRange("year", new Date("2026-07-05T10:30:00Z"), 4)!;
    expect(r.start).toEqual(new Date("2025-04-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2025-07-05T10:30:00Z"));
  });

  it("'quarter' shifts the fiscal quarter back 3 months (AU July: Jul → Apr)", () => {
    // now = Jul 5 2026 (AU Q1 start Jul 1) → previous quarter = AU Q4 (Apr–Jun), start Apr 1 2026.
    const r = previousPeriodRange("quarter", new Date("2026-07-05T10:30:00Z"), 7)!;
    expect(r.start).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2026-04-05T10:30:00Z"));
  });

  it("'quarter' shifts the NZ fiscal quarter back 3 months (Aug → Apr)", () => {
    // now = Aug 5 2026 (NZ Q2 start Jul 1) → previous quarter = NZ Q1 (Apr–Jun), start Apr 1 2026.
    const r = previousPeriodRange("quarter", new Date("2026-08-05T10:30:00Z"), 4)!;
    expect(r.start).toEqual(new Date("2026-04-01T00:00:00Z"));
    expect(r.end).toEqual(new Date("2026-05-05T10:30:00Z"));
  });
});
