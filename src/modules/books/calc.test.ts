import { describe, expect, it } from "vitest";
import {
  fiscalQuarter,
  summarizeGst,
  summarizeTransactions,
  type GstSummaryInput,
  type TransactionSummaryInput,
} from "./calc";

/** Helper: build an input row with a sensible default date. */
function row(
  partial: Omit<TransactionSummaryInput, "date"> & { date?: Date },
): TransactionSummaryInput {
  return { date: new Date("2026-03-15T12:00:00Z"), ...partial };
}

describe("summarizeTransactions", () => {
  it("returns zeros + empty arrays for empty input", () => {
    const s = summarizeTransactions([]);
    expect(s.incomeCents).toBe(0);
    expect(s.expenseCents).toBe(0);
    expect(s.netCents).toBe(0);
    expect(s.count).toBe(0);
    expect(s.byCategory).toEqual([]);
    expect(s.monthly).toEqual([]);
  });

  it("sums income + expense and computes net (positive)", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 10000, category: "services" }),
      row({ type: "income", amountCents: 5000, category: "sales" }),
      row({ type: "expense", amountCents: 3000, category: "rent" }),
    ]);
    expect(s.incomeCents).toBe(15000);
    expect(s.expenseCents).toBe(3000);
    expect(s.netCents).toBe(12000);
    expect(s.count).toBe(3);
  });

  it("produces a negative net when expense exceeds income", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 2000, category: "sales" }),
      row({ type: "expense", amountCents: 5000, category: "rent" }),
    ]);
    expect(s.netCents).toBe(-3000);
  });

  it("aggregates per category and sorts income-first then by amount desc", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 1000, category: "sales" }),
      row({ type: "income", amountCents: 3000, category: "services" }),
      row({ type: "income", amountCents: 2000, category: "services" }),
      row({ type: "expense", amountCents: 4000, category: "rent" }),
      row({ type: "expense", amountCents: 1000, category: "supplies" }),
    ]);
    // Income first, then expense; within each, desc by amount.
    expect(s.byCategory.map((c) => `${c.type}|${c.category}|${c.amountCents}|${c.count}`)).toEqual([
      "income|services|5000|2",
      "income|sales|1000|1",
      "expense|rent|4000|1",
      "expense|supplies|1000|1",
    ]);
  });

  it("groups rows in the same calendar month into one point", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 1000, category: "sales", date: new Date("2026-03-03") }),
      row({ type: "income", amountCents: 2000, category: "sales", date: new Date("2026-03-28") }),
      row({ type: "expense", amountCents: 500, category: "rent", date: new Date("2026-03-15") }),
    ]);
    expect(s.monthly).toHaveLength(1);
    expect(s.monthly[0]!.month).toBe("2026-03");
    expect(s.monthly[0]!.incomeCents).toBe(3000);
    expect(s.monthly[0]!.expenseCents).toBe(500);
    expect(s.monthly[0]!.netCents).toBe(2500);
  });

  it("sorts monthly points ascending by month and nets each month", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 1000, category: "sales", date: new Date("2026-03-15") }),
      row({ type: "expense", amountCents: 2500, category: "rent", date: new Date("2026-01-10") }),
      row({ type: "income", amountCents: 500, category: "sales", date: new Date("2026-02-20") }),
      row({
        type: "expense",
        amountCents: 200,
        category: "supplies",
        date: new Date("2026-01-31"),
      }),
    ]);
    expect(s.monthly.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.monthly[0]!.netCents).toBe(-2700); // -2500 - 200
    expect(s.monthly[1]!.netCents).toBe(500);
    expect(s.monthly[2]!.netCents).toBe(1000);
  });

  it("treats amountCents as Math.abs (a stray negative expense doesn't inflate income)", () => {
    const s = summarizeTransactions([
      row({ type: "expense", amountCents: -2000, category: "rent" }),
      row({ type: "income", amountCents: 1000, category: "sales" }),
    ]);
    // The negative expense is abs'd to 2000 — it does NOT add to income.
    expect(s.incomeCents).toBe(1000);
    expect(s.expenseCents).toBe(2000);
    expect(s.netCents).toBe(-1000);
  });

  it("accumulates gstCents into the GST summary (income collected, expense paid)", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 11000, category: "sales", gstCents: 1000 }),
      row({ type: "expense", amountCents: 2200, category: "rent", gstCents: 200 }),
      row({ type: "income", amountCents: 5500, category: "services", gstCents: 500 }),
    ]);
    expect(s.gstCollectedCents).toBe(1500); // 1000 + 500
    expect(s.gstPaidCents).toBe(200);
    expect(s.netGstCents).toBe(1300);
  });

  it("defaults gstCents to 0 when not supplied (backward compatible)", () => {
    const s = summarizeTransactions([
      row({ type: "income", amountCents: 1000, category: "sales" }),
    ]);
    expect(s.gstCollectedCents).toBe(0);
    expect(s.gstPaidCents).toBe(0);
    expect(s.netGstCents).toBe(0);
  });
});

describe("fiscalQuarter (Australian FY starts July)", () => {
  it("Q1 = Jul–Sep, fiscalYear = year the FY started", () => {
    expect(fiscalQuarter(new Date("2026-07-01"))).toEqual({
      fiscalYear: 2026,
      quarter: 1,
      label: "2026-Q1",
    });
    expect(fiscalQuarter(new Date("2026-09-30"))).toEqual({
      fiscalYear: 2026,
      quarter: 1,
      label: "2026-Q1",
    });
  });

  it("Q2 = Oct–Dec", () => {
    expect(fiscalQuarter(new Date("2026-10-15"))).toEqual({
      fiscalYear: 2026,
      quarter: 2,
      label: "2026-Q2",
    });
    expect(fiscalQuarter(new Date("2026-12-31"))).toEqual({
      fiscalYear: 2026,
      quarter: 2,
      label: "2026-Q2",
    });
  });

  it("Q3 = Jan–Mar (rolls fiscalYear back to prior year)", () => {
    expect(fiscalQuarter(new Date("2027-01-10"))).toEqual({
      fiscalYear: 2026,
      quarter: 3,
      label: "2026-Q3",
    });
    expect(fiscalQuarter(new Date("2027-03-31"))).toEqual({
      fiscalYear: 2026,
      quarter: 3,
      label: "2026-Q3",
    });
  });

  it("Q4 = Apr–Jun", () => {
    expect(fiscalQuarter(new Date("2027-04-01"))).toEqual({
      fiscalYear: 2026,
      quarter: 4,
      label: "2026-Q4",
    });
    expect(fiscalQuarter(new Date("2027-06-30"))).toEqual({
      fiscalYear: 2026,
      quarter: 4,
      label: "2026-Q4",
    });
  });
});

describe("fiscalQuarter — configurable fyStartMonth", () => {
  it("default (7 = July) preserves the Australian behaviour", () => {
    expect(fiscalQuarter(new Date("2026-08-15"))).toEqual({
      fiscalYear: 2026,
      quarter: 1,
      label: "2026-Q1",
    });
    expect(fiscalQuarter(new Date("2027-02-15"))).toEqual({
      fiscalYear: 2026,
      quarter: 3,
      label: "2026-Q3",
    });
  });

  it("NZ (fyStartMonth=4): Q1=Apr–Jun, Q2=Jul–Sep, Q3=Oct–Dec, Q4=Jan–Mar", () => {
    // May 2026 → NZ FY2026 Q1 (Apr–Jun 2026).
    expect(fiscalQuarter(new Date("2026-05-15"), 4)).toEqual({
      fiscalYear: 2026,
      quarter: 1,
      label: "2026-Q1",
    });
    // Aug 2026 → NZ FY2026 Q2 (Jul–Sep 2026).
    expect(fiscalQuarter(new Date("2026-08-15"), 4)).toEqual({
      fiscalYear: 2026,
      quarter: 2,
      label: "2026-Q2",
    });
    // Nov 2026 → NZ FY2026 Q3 (Oct–Dec 2026).
    expect(fiscalQuarter(new Date("2026-11-15"), 4)).toEqual({
      fiscalYear: 2026,
      quarter: 3,
      label: "2026-Q3",
    });
    // Feb 2027 → NZ FY2026 Q4 (Jan–Mar 2027); fiscalYear is the FY-start year 2026.
    expect(fiscalQuarter(new Date("2027-02-15"), 4)).toEqual({
      fiscalYear: 2026,
      quarter: 4,
      label: "2026-Q4",
    });
  });

  it("January (fyStartMonth=1) = calendar-year quarters", () => {
    expect(fiscalQuarter(new Date("2026-02-15"), 1)).toEqual({
      fiscalYear: 2026,
      quarter: 1,
      label: "2026-Q1",
    });
    expect(fiscalQuarter(new Date("2026-07-15"), 1)).toEqual({
      fiscalYear: 2026,
      quarter: 3,
      label: "2026-Q3",
    });
  });
});

describe("summarizeGst — configurable fyStartMonth", () => {
  function grow(partial: Omit<GstSummaryInput, "date"> & { date?: Date }): GstSummaryInput {
    return { date: new Date("2026-08-15T12:00:00Z"), ...partial };
  }

  it("default (7 = July) keeps the Australian quarter labels", () => {
    const s = summarizeGst([
      grow({ type: "income", gstCents: 1000, date: new Date("2026-08-01") }), // AU Q1
      grow({ type: "expense", gstCents: 200, date: new Date("2027-02-01") }), // AU Q3
    ]);
    expect(s.byQuarter.map((q) => q.label)).toEqual(["2026-Q1", "2026-Q3"]);
  });

  it("NZ (fyStartMonth=4) regroups the same dates into NZ fiscal quarters", () => {
    // Aug 2026 is NZ Q2 (not AU Q1); Feb 2027 is NZ Q4 (not AU Q3).
    const s = summarizeGst(
      [
        grow({ type: "income", gstCents: 1000, date: new Date("2026-08-01") }),
        grow({ type: "expense", gstCents: 200, date: new Date("2027-02-01") }),
      ],
      4,
    );
    expect(s.byQuarter.map((q) => q.label)).toEqual(["2026-Q2", "2026-Q4"]);
  });
});

describe("summarizeGst", () => {
  function grow(partial: Omit<GstSummaryInput, "date"> & { date?: Date }): GstSummaryInput {
    return { date: new Date("2026-08-15T12:00:00Z"), ...partial };
  }

  it("returns zeros + empty byQuarter for empty input", () => {
    const s = summarizeGst([]);
    expect(s.gstCollectedCents).toBe(0);
    expect(s.gstPaidCents).toBe(0);
    expect(s.netGstCents).toBe(0);
    expect(s.byQuarter).toEqual([]);
  });

  it("splits collected (income) vs paid (expense) and nets them", () => {
    const s = summarizeGst([
      grow({ type: "income", gstCents: 1000, date: new Date("2026-08-01") }),
      grow({ type: "expense", gstCents: 300, date: new Date("2026-08-01") }),
    ]);
    expect(s.gstCollectedCents).toBe(1000);
    expect(s.gstPaidCents).toBe(300);
    expect(s.netGstCents).toBe(700);
  });

  it("groups by financial-year quarter and sorts ascending", () => {
    const s = summarizeGst([
      // Q3 FY2026 (Jan 2027)
      grow({ type: "income", gstCents: 500, date: new Date("2027-02-01") }),
      // Q1 FY2026 (Aug 2026)
      grow({ type: "income", gstCents: 1000, date: new Date("2026-08-01") }),
      // Q4 FY2026 (May 2027)
      grow({ type: "expense", gstCents: 200, date: new Date("2027-05-01") }),
    ]);
    expect(s.byQuarter.map((q) => q.label)).toEqual(["2026-Q1", "2026-Q3", "2026-Q4"]);
    expect(s.byQuarter[0]!.netGstCents).toBe(1000);
    expect(s.byQuarter[1]!.netGstCents).toBe(500);
    expect(s.byQuarter[2]!.netGstCents).toBe(-200);
  });

  it("abs's gstCents so a stray negative doesn't inflate totals", () => {
    const s = summarizeGst([grow({ type: "income", gstCents: -1000 })]);
    expect(s.gstCollectedCents).toBe(1000);
  });
});
