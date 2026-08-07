import { describe, expect, it } from "vitest";
import { consolidateBusinessIncome } from "./business-overview";

describe("consolidateBusinessIncome", () => {
  it("uses Books as the canonical total so mirrored invoice and Drive income is not doubled", () => {
    expect(
      consolidateBusinessIncome({
        books: { currentCents: 30_000, previousCents: 20_000 },
        invoices: { currentCents: 20_000, previousCents: 15_000 },
        drive: { currentCents: 10_000, previousCents: 5_000 },
      }),
    ).toEqual({ currentCents: 30_000, previousCents: 20_000, source: "books" });
  });

  it("combines paid invoices and Drive earnings when Books is not installed", () => {
    expect(
      consolidateBusinessIncome({
        invoices: { currentCents: 20_000, previousCents: 12_000 },
        drive: { currentCents: 7_500, previousCents: 5_000 },
      }),
    ).toEqual({ currentCents: 27_500, previousCents: 17_000, source: "modules" });
  });

  it("returns no source for a workspace without an income-producing module", () => {
    expect(consolidateBusinessIncome({})).toEqual({
      currentCents: 0,
      previousCents: null,
      source: null,
    });
  });
});
