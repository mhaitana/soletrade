import { describe, expect, it } from "vitest";
import { summarizeQuotes, type QuoteSummaryInput } from "@/lib/domain/quotes/calc";

const range = {
  start: new Date("2026-07-01T00:00:00Z"),
  end: new Date("2026-07-31T23:59:59Z"),
};

function row(
  partial: Partial<QuoteSummaryInput> & { status: QuoteSummaryInput["status"] },
): QuoteSummaryInput {
  return {
    totalCents: 10000,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    convertedAt: null,
    issueDate: new Date("2026-07-15T00:00:00Z"),
    ...partial,
  };
}

describe("modules/quotes/calc - summarizeQuotes", () => {
  it("returns zeros + empty monthly for empty input", () => {
    const s = summarizeQuotes([], range);
    expect(s).toEqual({
      acceptedValueCents: 0,
      sentCount: 0,
      acceptedCount: 0,
      declinedCount: 0,
      convertedCount: 0,
      monthly: [],
    });
  });

  it("acceptedValueCents sums totalCents for status === 'accepted' - all-time snapshot", () => {
    const s = summarizeQuotes(
      [
        row({ status: "accepted", totalCents: 5000 }),
        row({ status: "accepted", totalCents: 7000 }),
        row({ status: "converted", totalCents: 9999 }), // converted doesn't count toward pending
        row({ status: "sent", totalCents: 4321 }),
        row({ status: "declined", totalCents: 1234 }),
      ],
      range,
    );
    expect(s.acceptedValueCents).toBe(12000); // 5000 + 7000
  });

  it("sentCount counts quotes sent in range (by sentAt)", () => {
    const s = summarizeQuotes(
      [
        row({ status: "sent", sentAt: new Date("2026-07-05T00:00:00Z") }),
        row({ status: "viewed", sentAt: new Date("2026-07-06T00:00:00Z") }),
        row({ status: "accepted", sentAt: new Date("2026-07-07T00:00:00Z") }),
        // Sent before range - excluded.
        row({ status: "sent", sentAt: new Date("2026-06-30T00:00:00Z") }),
        // Never sent (draft) - excluded.
        row({ status: "draft", sentAt: null }),
      ],
      range,
    );
    expect(s.sentCount).toBe(3);
  });

  it("acceptedCount/declinedCount/convertedCount are period-bound by their respective timestamps", () => {
    const s = summarizeQuotes(
      [
        row({ status: "accepted", acceptedAt: new Date("2026-07-10T00:00:00Z") }),
        row({ status: "accepted", acceptedAt: new Date("2026-06-10T00:00:00Z") }), // before range
        row({ status: "declined", declinedAt: new Date("2026-07-11T00:00:00Z") }),
        row({ status: "converted", convertedAt: new Date("2026-07-12T00:00:00Z") }),
        row({ status: "converted", convertedAt: new Date("2026-05-01T00:00:00Z") }), // before range
      ],
      range,
    );
    expect(s.acceptedCount).toBe(1);
    expect(s.declinedCount).toBe(1);
    expect(s.convertedCount).toBe(1);
  });

  it("monthly groups accepted quotes by YYYY-MM (by acceptedAt), sorted ascending", () => {
    const s = summarizeQuotes(
      [
        row({
          status: "accepted",
          totalCents: 10000,
          acceptedAt: new Date("2026-07-10T00:00:00Z"),
        }),
        row({ status: "accepted", totalCents: 5000, acceptedAt: new Date("2026-07-25T00:00:00Z") }),
        row({ status: "accepted", totalCents: 8000, acceptedAt: new Date("2026-05-03T00:00:00Z") }),
      ],
      { start: null, end: new Date("2026-12-31T00:00:00Z") },
    );
    expect(s.monthly).toEqual([
      { month: "2026-05", acceptedCents: 8000, acceptedCount: 1 },
      { month: "2026-07", acceptedCents: 15000, acceptedCount: 2 },
    ]);
  });

  it("treats range.start === null as no lower bound (all-time period)", () => {
    const all = { start: null, end: new Date("2026-12-31T00:00:00Z") };
    const s = summarizeQuotes(
      [
        row({ status: "accepted", acceptedAt: new Date("2020-01-01T00:00:00Z") }),
        row({ status: "accepted", acceptedAt: new Date("2026-07-01T00:00:00Z") }),
      ],
      all,
    );
    expect(s.acceptedCount).toBe(2);
  });

  it("previous-period filtering: same rows, a previous range excludes current-period accepted", () => {
    const rows: QuoteSummaryInput[] = [
      row({ status: "accepted", totalCents: 10000, acceptedAt: new Date("2026-07-10T00:00:00Z") }),
      row({ status: "accepted", totalCents: 4000, acceptedAt: new Date("2026-06-10T00:00:00Z") }),
    ];
    const current = summarizeQuotes(rows, range);
    const previous = summarizeQuotes(rows, {
      start: new Date("2026-06-01T00:00:00Z"),
      end: new Date("2026-06-30T23:59:59Z"),
    });
    expect(current.acceptedCount).toBe(1);
    expect(previous.acceptedCount).toBe(1); // only the June accepted quote
    // Snapshot is identical regardless of range.
    expect(current.acceptedValueCents).toBe(previous.acceptedValueCents);
  });
});
