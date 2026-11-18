import { describe, expect, it } from "vitest";
import { formatAsOf, localDate, quarterJustEnded } from "@/lib/domain/insights/local-date";

describe("localDate", () => {
  it("gives the workspace's date, which can differ from the UTC date", () => {
    // 20:30 UTC on the 18th is already 07:30 on the 19th in Sydney.
    const now = new Date("2026-11-18T20:30:00Z");
    expect(localDate(now, "Australia/Sydney")).toEqual({
      date: "2026-11-19",
      timezone: "Australia/Sydney",
    });
    expect(localDate(now, "UTC").date).toBe("2026-11-18");
    // The same instant is still mid-afternoon on the 18th in Los Angeles.
    expect(localDate(now, "America/Los_Angeles").date).toBe("2026-11-18");
  });

  it("changes date at local midnight, not at UTC midnight", () => {
    // Sydney is UTC+11 in November, so its midnight is 13:00 UTC.
    expect(localDate(new Date("2026-11-19T12:59:59Z"), "Australia/Sydney").date).toBe("2026-11-19");
    expect(localDate(new Date("2026-11-19T13:00:00Z"), "Australia/Sydney").date).toBe("2026-11-20");
    // Los Angeles is UTC-8, so the UTC date turns over eight hours before the local one.
    expect(localDate(new Date("2026-11-20T07:59:59Z"), "America/Los_Angeles").date).toBe(
      "2026-11-19",
    );
    expect(localDate(new Date("2026-11-20T08:00:00Z"), "America/Los_Angeles").date).toBe(
      "2026-11-20",
    );
  });

  it("follows daylight saving", () => {
    // Sydney is UTC+10 in July: midnight is 14:00 UTC.
    expect(localDate(new Date("2026-07-01T13:59:59Z"), "Australia/Sydney").date).toBe("2026-07-01");
    expect(localDate(new Date("2026-07-01T14:00:00Z"), "Australia/Sydney").date).toBe("2026-07-02");
  });

  it("falls back to UTC for a missing or unknown timezone", () => {
    const now = new Date("2026-11-18T20:30:00Z");
    expect(localDate(now, "Not/AZone")).toEqual({ date: "2026-11-18", timezone: "UTC" });
    expect(localDate(now, "")).toEqual({ date: "2026-11-18", timezone: "UTC" });
    expect(localDate(now, null)).toEqual({ date: "2026-11-18", timezone: "UTC" });
    expect(localDate(now, undefined)).toEqual({ date: "2026-11-18", timezone: "UTC" });
  });
});

describe("formatAsOf", () => {
  it("shows the moment in the workspace's timezone", () => {
    const now = new Date("2026-11-18T20:41:00Z");
    expect(formatAsOf(now, "Australia/Sydney")).toMatch(/^19 Nov, 7:41 am$/i);
    expect(formatAsOf(now, "America/Los_Angeles")).toMatch(/^18 Nov, 12:41 pm$/i);
    expect(formatAsOf(now, "UTC")).toMatch(/^18 Nov, 8:41 pm$/i);
  });

  it("uses plain spaces so the label can be compared and wrapped as normal text", () => {
    expect(formatAsOf(new Date("2026-11-18T20:41:00Z"), "UTC")).not.toMatch(/[  ]/);
  });
});

describe("quarterJustEnded", () => {
  it("returns the quarter that ended last month, for a July financial year", () => {
    expect(quarterJustEnded("2026-10-01", 7)).toEqual({
      fiscalYear: 2026,
      quarter: 1,
      label: "2026-Q1",
    });
    expect(quarterJustEnded("2026-10-31", 7)?.label).toBe("2026-Q1");
    expect(quarterJustEnded("2027-01-15", 7)?.label).toBe("2026-Q2");
    expect(quarterJustEnded("2027-04-15", 7)?.label).toBe("2026-Q3");
    // July starts a new financial year; the quarter that ended belongs to the old one.
    expect(quarterJustEnded("2027-07-15", 7)?.label).toBe("2026-Q4");
  });

  it("returns nothing in the other two months of a quarter", () => {
    for (const today of ["2026-11-01", "2026-11-30", "2026-12-15", "2026-09-30", "2027-02-01"]) {
      expect(quarterJustEnded(today, 7)).toBeNull();
    }
  });

  it("follows the workspace's financial-year start month", () => {
    // Calendar-year books: quarters end in March, June, September and December.
    expect(quarterJustEnded("2026-10-10", 1)?.label).toBe("2026-Q3");
    expect(quarterJustEnded("2027-01-10", 1)?.label).toBe("2026-Q4");
    expect(quarterJustEnded("2026-11-10", 1)).toBeNull();
    // An April start (as in New Zealand): quarters end in June, September, December, March.
    expect(quarterJustEnded("2026-07-10", 4)?.label).toBe("2026-Q1");
    expect(quarterJustEnded("2027-04-10", 4)?.label).toBe("2026-Q4");
    // A February start: quarters end in April, July, October and January.
    expect(quarterJustEnded("2026-11-10", 2)?.label).toBe("2026-Q3");
    expect(quarterJustEnded("2026-10-10", 2)).toBeNull();
  });
});
