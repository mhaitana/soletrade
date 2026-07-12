import { describe, expect, it } from "vitest";
import { formatKm, summarizeDrive, type EarningSummaryInput, type TripSummaryInput } from "./calc";

/** Helper: build an earning input with a sensible default date. */
function earning(
  partial: Omit<EarningSummaryInput, "date"> & { date?: Date },
): EarningSummaryInput {
  return { date: new Date("2026-03-15T12:00:00Z"), ...partial };
}

/** Helper: build a trip input with a sensible default date. */
function trip(partial: Omit<TripSummaryInput, "date"> & { date?: Date }): TripSummaryInput {
  return { date: new Date("2026-03-15T12:00:00Z"), ...partial };
}

describe("summarizeDrive", () => {
  it("returns zeros + empty arrays for empty input", () => {
    const s = summarizeDrive([], []);
    expect(s.totalEarningsCents).toBe(0);
    expect(s.totalDistanceMeters).toBe(0);
    expect(s.earningsCount).toBe(0);
    expect(s.tripsCount).toBe(0);
    expect(s.byPlatform).toEqual([]);
    expect(s.monthly).toEqual([]);
  });

  it("sums earnings + distance and counts each independently", () => {
    const s = summarizeDrive(
      [
        earning({ amountCents: 12000, platform: "uber" }),
        earning({ amountCents: 8000, platform: "doordash" }),
      ],
      [trip({ distanceMeters: 45200, platform: "uber" })],
    );
    expect(s.totalEarningsCents).toBe(20000);
    expect(s.totalDistanceMeters).toBe(45200);
    expect(s.earningsCount).toBe(2);
    expect(s.tripsCount).toBe(1);
  });

  it("aggregates per platform and sorts desc by earningsCents (platforms with trips only still appear)", () => {
    const s = summarizeDrive(
      [
        earning({ amountCents: 5000, platform: "uber" }),
        earning({ amountCents: 3000, platform: "doordash" }),
        earning({ amountCents: 7000, platform: "uber" }),
      ],
      [trip({ distanceMeters: 10000, platform: "airtasker" })],
    );
    expect(
      s.byPlatform.map(
        (p) =>
          `${p.platform}|${p.earningsCents}|${p.distanceMeters}|${p.earningsCount}|${p.tripsCount}`,
      ),
    ).toEqual(["uber|12000|0|2|0", "doordash|3000|0|1|0", "airtasker|0|10000|0|1"]);
  });

  it("groups rows in the same calendar month into one point", () => {
    const s = summarizeDrive(
      [
        earning({ amountCents: 1000, platform: "uber", date: new Date("2026-03-03") }),
        earning({ amountCents: 2000, platform: "uber", date: new Date("2026-03-28") }),
      ],
      [trip({ distanceMeters: 5000, platform: "uber", date: new Date("2026-03-15") })],
    );
    expect(s.monthly).toHaveLength(1);
    expect(s.monthly[0]!.month).toBe("2026-03");
    expect(s.monthly[0]!.earningsCents).toBe(3000);
    expect(s.monthly[0]!.distanceMeters).toBe(5000);
  });

  it("sorts monthly points ascending by month", () => {
    const s = summarizeDrive(
      [
        earning({ amountCents: 1000, platform: "uber", date: new Date("2026-03-15") }),
        earning({ amountCents: 500, platform: "uber", date: new Date("2026-02-20") }),
      ],
      [trip({ distanceMeters: 2000, platform: "doordash", date: new Date("2026-01-10") })],
    );
    expect(s.monthly.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.monthly[0]!.earningsCents).toBe(0);
    expect(s.monthly[0]!.distanceMeters).toBe(2000);
    expect(s.monthly[1]!.earningsCents).toBe(500);
    expect(s.monthly[2]!.earningsCents).toBe(1000);
  });

  it("treats amountCents + distanceMeters as Math.abs (negatives don't inflate totals)", () => {
    const s = summarizeDrive(
      [earning({ amountCents: -2000, platform: "uber" })],
      [trip({ distanceMeters: -5000, platform: "uber" })],
    );
    expect(s.totalEarningsCents).toBe(2000);
    expect(s.totalDistanceMeters).toBe(5000);
  });
});

describe("formatKm", () => {
  it("formats meters as km with one decimal", () => {
    expect(formatKm(45200)).toBe("45.2 km");
    expect(formatKm(1000)).toBe("1.0 km");
    expect(formatKm(0)).toBe("0.0 km");
  });

  it("abs's the input so a stray negative never renders a minus", () => {
    expect(formatKm(-45200)).toBe("45.2 km");
  });
});

describe("summarizeDrive - Wave 2 (weekly + deduction + profit)", () => {
  it("defaults deduction/expenses/profit to 0 when no opts supplied (backward compatible)", () => {
    const s = summarizeDrive([earning({ amountCents: 1000, platform: "uber" })], []);
    expect(s.mileageDeductionCents).toBe(0);
    expect(s.totalExpensesCents).toBe(0);
    // profit = earnings - 0 - 0 = earnings
    expect(s.profitCents).toBe(1000);
  });

  it("weekly is empty when there are no earnings or trips", () => {
    const s = summarizeDrive([], []);
    expect(s.weekly).toEqual([]);
  });

  it("groups earnings into ISO-Monday-anchored weekly points", () => {
    // 2026-07-08 is a Wednesday (week Monday = 2026-07-06); 2026-07-12 is Sunday (same week).
    const s = summarizeDrive(
      [
        earning({ amountCents: 1000, platform: "uber", date: new Date("2026-07-08T12:00:00Z") }),
        earning({ amountCents: 2000, platform: "uber", date: new Date("2026-07-12T12:00:00Z") }),
        earning({ amountCents: 500, platform: "uber", date: new Date("2026-07-06T00:00:00Z") }),
      ],
      [],
    );
    // All three land in the same week (Mon 2026-07-06).
    expect(s.weekly).toHaveLength(1);
    expect(s.weekly[0]!.week).toBe("2026-07-06");
    expect(s.weekly[0]!.earningsCents).toBe(3500);
  });

  it("sorts weekly points ascending by week key", () => {
    const s = summarizeDrive(
      [
        earning({ amountCents: 1000, platform: "uber", date: new Date("2026-07-08T12:00:00Z") }),
        earning({ amountCents: 500, platform: "uber", date: new Date("2026-06-25T12:00:00Z") }),
      ],
      [],
    );
    expect(s.weekly.map((w) => w.week)).toEqual(["2026-06-22", "2026-07-06"]);
  });

  it("computes mileageDeductionCents = round(totalDistanceKm * rate)", () => {
    // 45200 m = 45.2 km; rate 85 c/km → round(45.2 * 85) = round(3842) = 3842.
    const s = summarizeDrive([], [trip({ distanceMeters: 45200, platform: "uber" })], {
      settings: { mileageRateCentsPerKm: 85 },
    });
    expect(s.mileageDeductionCents).toBe(3842);
  });

  it("mileageDeductionCents is 0 when no rate is supplied", () => {
    const s = summarizeDrive([], [trip({ distanceMeters: 45200, platform: "uber" })]);
    expect(s.mileageDeductionCents).toBe(0);
  });

  it("sums vehicle expenses from opts.expenses", () => {
    const s = summarizeDrive([], [], {
      expenses: [{ amountCents: 5000 }, { amountCents: 3000 }, { amountCents: -200 }],
    });
    // Math.abs applied defensively → 5000 + 3000 + 200 = 8200.
    expect(s.totalExpensesCents).toBe(8200);
  });

  it("profitCents = earnings - expenses - mileageDeduction (can go negative)", () => {
    const s = summarizeDrive(
      [earning({ amountCents: 10000, platform: "uber" })],
      [trip({ distanceMeters: 200000, platform: "uber" })], // 200 km * 85 = 17000 deduction
      { settings: { mileageRateCentsPerKm: 85 }, expenses: [{ amountCents: 3000 }] },
    );
    // 10000 - 3000 - 17000 = -10000
    expect(s.profitCents).toBe(-10000);
  });
});
