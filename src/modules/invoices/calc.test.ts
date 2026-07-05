import { describe, expect, it } from "vitest";
import { summarizeInvoices, type InvoiceSummaryInput } from "./calc";

const range = {
  start: new Date("2026-07-01T00:00:00Z"),
  end: new Date("2026-07-31T23:59:59Z"),
};

function row(
  partial: Partial<InvoiceSummaryInput> & { status: InvoiceSummaryInput["status"] },
): InvoiceSummaryInput {
  return {
    totalCents: 10000,
    sentAt: null,
    paidAt: null,
    issueDate: new Date("2026-07-15T00:00:00Z"),
    ...partial,
  };
}

describe("modules/invoices/calc — summarizeInvoices", () => {
  it("returns zeros + empty monthly for empty input", () => {
    const s = summarizeInvoices([], range);
    expect(s).toEqual({
      outstandingCents: 0,
      overdueCount: 0,
      draftCount: 0,
      paidCents: 0,
      paidCount: 0,
      sentCount: 0,
      monthly: [],
    });
  });

  it("outstandingCents sums totalCents for status in (sent, viewed, overdue) — all-time snapshot", () => {
    const s = summarizeInvoices(
      [
        row({ status: "sent", totalCents: 5000 }),
        row({ status: "viewed", totalCents: 3000 }),
        row({ status: "overdue", totalCents: 7000 }),
        row({ status: "paid", totalCents: 9999 }),
        row({ status: "draft", totalCents: 1234 }),
        row({ status: "void", totalCents: 4321 }),
      ],
      range,
    );
    expect(s.outstandingCents).toBe(15000); // 5000 + 3000 + 7000
  });

  it("overdueCount + draftCount are all-time snapshots", () => {
    const s = summarizeInvoices(
      [
        row({ status: "overdue" }),
        row({ status: "overdue" }),
        row({ status: "draft" }),
        row({ status: "sent" }),
      ],
      range,
    );
    expect(s.overdueCount).toBe(2);
    expect(s.draftCount).toBe(1);
  });

  it("paidCents/paidCount count invoices paid in range (by paidAt)", () => {
    const s = summarizeInvoices(
      [
        row({ status: "paid", totalCents: 10000, paidAt: new Date("2026-07-10T00:00:00Z") }),
        row({ status: "paid", totalCents: 20000, paidAt: new Date("2026-07-20T00:00:00Z") }),
        // Paid before the range — excluded.
        row({ status: "paid", totalCents: 99999, paidAt: new Date("2026-06-15T00:00:00Z") }),
        // Paid after the range — excluded.
        row({ status: "paid", totalCents: 88888, paidAt: new Date("2026-08-01T00:00:00Z") }),
      ],
      range,
    );
    expect(s.paidCents).toBe(30000);
    expect(s.paidCount).toBe(2);
  });

  it("sentCount counts invoices sent in range (by sentAt)", () => {
    const s = summarizeInvoices(
      [
        row({ status: "sent", sentAt: new Date("2026-07-05T00:00:00Z") }),
        row({ status: "viewed", sentAt: new Date("2026-07-06T00:00:00Z") }),
        row({ status: "paid", sentAt: new Date("2026-07-07T00:00:00Z") }),
        // Sent before the range — excluded.
        row({ status: "sent", sentAt: new Date("2026-06-30T00:00:00Z") }),
        // Never sent (draft) — excluded.
        row({ status: "draft", sentAt: null }),
      ],
      range,
    );
    expect(s.sentCount).toBe(3);
  });

  it("monthly groups paid invoices by YYYY-MM, sorted ascending", () => {
    const s = summarizeInvoices(
      [
        row({ status: "paid", totalCents: 10000, paidAt: new Date("2026-07-10T00:00:00Z") }),
        row({ status: "paid", totalCents: 5000, paidAt: new Date("2026-07-25T00:00:00Z") }),
        row({ status: "paid", totalCents: 8000, paidAt: new Date("2026-05-03T00:00:00Z") }),
      ],
      // Use an "all" range so all paid rows are in range.
      { start: null, end: new Date("2026-12-31T00:00:00Z") },
    );
    expect(s.monthly).toEqual([
      { month: "2026-05", paidCents: 8000, paidCount: 1 },
      { month: "2026-07", paidCents: 15000, paidCount: 2 },
    ]);
  });

  it("treats range.start === null as no lower bound (all-time period)", () => {
    const all = { start: null, end: new Date("2026-12-31T00:00:00Z") };
    const s = summarizeInvoices(
      [
        row({ status: "paid", totalCents: 10000, paidAt: new Date("2020-01-01T00:00:00Z") }),
        row({ status: "paid", totalCents: 20000, paidAt: new Date("2026-07-01T00:00:00Z") }),
      ],
      all,
    );
    expect(s.paidCents).toBe(30000);
    expect(s.paidCount).toBe(2);
  });

  it("previous-period filtering: same rows, a previous range excludes current-period paid", () => {
    const rows: InvoiceSummaryInput[] = [
      row({ status: "paid", totalCents: 10000, paidAt: new Date("2026-07-10T00:00:00Z") }),
      row({ status: "paid", totalCents: 4000, paidAt: new Date("2026-06-10T00:00:00Z") }),
    ];
    const current = summarizeInvoices(rows, range);
    const previous = summarizeInvoices(rows, {
      start: new Date("2026-06-01T00:00:00Z"),
      end: new Date("2026-06-30T23:59:59Z"),
    });
    expect(current.paidCents).toBe(10000);
    expect(previous.paidCents).toBe(4000); // only the June paid invoice
    // Snapshots are identical regardless of range.
    expect(current.outstandingCents).toBe(previous.outstandingCents);
  });
});
