import { describe, expect, it } from "vitest";
import { summarizeTransactions, type TransactionSummaryInput } from "./calc";

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
});
