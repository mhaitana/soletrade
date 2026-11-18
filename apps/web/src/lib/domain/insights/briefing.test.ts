import { describe, expect, it } from "vitest";
import { composeBriefing, NOTHING_TO_REPORT } from "@/lib/domain/insights/briefing";
import type { InsightFacts } from "@/lib/domain/insights/facts";

/** Facts for a member who can see every area and has nothing waiting. */
function facts(overrides: Partial<InsightFacts> = {}): InsightFacts {
  return {
    asOf: "2026-11-18T20:41:00.000Z",
    today: "2026-11-19",
    timezone: "Australia/Sydney",
    currency: "AUD",
    overdueInvoices: { count: 0, totalCents: 0 },
    invoicesDueSoon: { count: 0, totalCents: 0 },
    draftInvoices: { count: 0 },
    acceptedQuotes: { count: 0, totalCents: 0 },
    quotesExpiringSoon: { count: 0, totalCents: 0 },
    receiptsToReview: { count: 0 },
    gstToLodge: null,
    ...overrides,
  };
}

describe("composeBriefing: nothing to report", () => {
  it("says so briefly when every count is zero", () => {
    expect(composeBriefing(facts())).toEqual({
      headline: NOTHING_TO_REPORT,
      items: [],
      empty: true,
    });
    expect(NOTHING_TO_REPORT).toBe("Nothing needs your attention right now.");
  });

  it("says the same when the member can see no area at all", () => {
    const hidden = facts({
      overdueInvoices: null,
      invoicesDueSoon: null,
      draftInvoices: null,
      acceptedQuotes: null,
      quotesExpiringSoon: null,
      receiptsToReview: null,
    });
    expect(composeBriefing(hidden)).toMatchObject({ headline: NOTHING_TO_REPORT, empty: true });
  });
});

describe("composeBriefing: invoice sentence", () => {
  it("uses the singular for one overdue invoice", () => {
    const briefing = composeBriefing(facts({ overdueInvoices: { count: 1, totalCents: 12050 } }));
    expect(briefing.headline).toBe("1 invoice is overdue, totalling $120.50.");
    expect(briefing.empty).toBe(false);
  });

  it("uses the plural and thousands separators for several", () => {
    const briefing = composeBriefing(facts({ overdueInvoices: { count: 3, totalCents: 450000 } }));
    expect(briefing.headline).toBe("3 invoices are overdue, totalling $4,500.00.");
  });

  it("reports invoices falling due on their own", () => {
    expect(
      composeBriefing(facts({ invoicesDueSoon: { count: 1, totalCents: 5000 } })).headline,
    ).toBe("1 invoice is due in the next 7 days, totalling $50.00.");
    expect(
      composeBriefing(facts({ invoicesDueSoon: { count: 2, totalCents: 120000 } })).headline,
    ).toBe("2 invoices are due in the next 7 days, totalling $1,200.00.");
  });

  it("joins overdue and due-soon invoices into one sentence", () => {
    expect(
      composeBriefing(
        facts({
          overdueInvoices: { count: 3, totalCents: 450000 },
          invoicesDueSoon: { count: 2, totalCents: 120000 },
        }),
      ).headline,
    ).toBe("3 invoices are overdue ($4,500.00) and 2 more are due in the next 7 days ($1,200.00).");
    expect(
      composeBriefing(
        facts({
          overdueInvoices: { count: 1, totalCents: 10000 },
          invoicesDueSoon: { count: 1, totalCents: 5000 },
        }),
      ).headline,
    ).toBe("1 invoice is overdue ($100.00) and 1 more is due in the next 7 days ($50.00).");
  });
});

describe("composeBriefing: everything else", () => {
  it("lists other items after the invoice sentence, in at most two sentences", () => {
    const briefing = composeBriefing(
      facts({
        overdueInvoices: { count: 3, totalCents: 450000 },
        invoicesDueSoon: { count: 2, totalCents: 120000 },
        acceptedQuotes: { count: 1, totalCents: 90000 },
        quotesExpiringSoon: { count: 2, totalCents: 300000 },
        receiptsToReview: { count: 4 },
        draftInvoices: { count: 1 },
        gstToLodge: { periodLabel: "2026-Q1", netGstCents: 123400 },
      }),
    );
    expect(briefing.headline).toBe(
      "3 invoices are overdue ($4,500.00) and 2 more are due in the next 7 days ($1,200.00). " +
        "Also waiting: 1 accepted quote to invoice ($900.00), 2 quotes expiring in the next 7 days ($3,000.00), " +
        "4 receipts to review, 1 draft invoice and GST for 2026-Q1 to lodge ($1,234.00 owed).",
    );
    expect(briefing.headline.match(/\.(\s|$)/g)).toHaveLength(2);
  });

  it("leads with what is waiting when no invoice is overdue or falling due", () => {
    expect(
      composeBriefing(facts({ receiptsToReview: { count: 1 }, draftInvoices: { count: 2 } }))
        .headline,
    ).toBe("Waiting for you: 1 receipt to review and 2 draft invoices.");
    expect(
      composeBriefing(facts({ acceptedQuotes: { count: 2, totalCents: 250000 } })).headline,
    ).toBe("Waiting for you: 2 accepted quotes to invoice ($2,500.00).");
    expect(
      composeBriefing(facts({ quotesExpiringSoon: { count: 1, totalCents: 80000 } })).headline,
    ).toBe("Waiting for you: 1 quote expiring in the next 7 days ($800.00).");
  });

  it("words GST as owed, a refund, or neither", () => {
    const gst = (netGstCents: number) =>
      composeBriefing(facts({ gstToLodge: { periodLabel: "2026-Q1", netGstCents } }));
    expect(gst(123400).headline).toBe(
      "Waiting for you: GST for 2026-Q1 to lodge ($1,234.00 owed).",
    );
    expect(gst(-20000).headline).toBe(
      "Waiting for you: GST for 2026-Q1 to lodge ($200.00 refund due).",
    );
    expect(gst(0).headline).toBe("Waiting for you: GST for 2026-Q1 to lodge.");
    expect(gst(123400).items[0]!.text).toBe(
      "GST for 2026-Q1 is not marked as lodged: $1,234.00 owed",
    );
    expect(gst(0).items[0]!.text).toBe("GST for 2026-Q1 is not marked as lodged");
  });
});

describe("composeBriefing: items", () => {
  const full = facts({
    overdueInvoices: { count: 1, totalCents: 10000 },
    invoicesDueSoon: { count: 2, totalCents: 20000 },
    acceptedQuotes: { count: 1, totalCents: 30000 },
    quotesExpiringSoon: { count: 1, totalCents: 40000 },
    receiptsToReview: { count: 1 },
    draftInvoices: { count: 2 },
    gstToLodge: { periodLabel: "2026-Q1", netGstCents: -5000 },
  });

  it("orders items by urgency and links each to where it can be dealt with", () => {
    expect(composeBriefing(full).items.map((item) => [item.id, item.href, item.linkLabel])).toEqual(
      [
        ["overdue-invoices", "/invoices?status=overdue", "Review overdue"],
        ["invoices-due-soon", "/invoices", "View invoices"],
        ["accepted-quotes", "/quotes?status=accepted", "Create invoices"],
        ["quotes-expiring-soon", "/quotes", "View quotes"],
        ["pending-receipts", "/books/receipts?status=pending", "Review receipts"],
        ["draft-invoices", "/invoices?status=draft", "Finish drafts"],
        ["gst-to-lodge", "/books/tax", "Open tax"],
      ],
    );
  });

  it("states each fact in full, with singular and plural forms", () => {
    expect(composeBriefing(full).items.map((item) => item.text)).toEqual([
      "1 invoice is overdue, totalling $100.00",
      "2 invoices are due in the next 7 days, totalling $200.00",
      "1 accepted quote is ready to invoice, worth $300.00",
      "1 quote expires in the next 7 days, worth $400.00",
      "1 receipt needs review",
      "2 draft invoices are unfinished",
      "GST for 2026-Q1 is not marked as lodged: $50.00 refund due",
    ]);
    const plural = composeBriefing(
      facts({
        acceptedQuotes: { count: 2, totalCents: 30000 },
        quotesExpiringSoon: { count: 3, totalCents: 40000 },
        receiptsToReview: { count: 5 },
        draftInvoices: { count: 1 },
      }),
    );
    expect(plural.items.map((item) => item.text)).toEqual([
      "2 accepted quotes are ready to invoice, worth $300.00",
      "3 quotes expire in the next 7 days, worth $400.00",
      "5 receipts need review",
      "1 draft invoice is unfinished",
    ]);
  });

  it("leaves out zero counts and areas the member cannot see", () => {
    const partial = facts({
      overdueInvoices: null,
      invoicesDueSoon: null,
      draftInvoices: null,
      acceptedQuotes: { count: 0, totalCents: 0 },
      receiptsToReview: { count: 2 },
    });
    expect(composeBriefing(partial).items.map((item) => item.id)).toEqual(["pending-receipts"]);
  });

  it("formats money in the workspace currency, or with the formatter it is given", () => {
    const nzd = facts({ currency: "NZD", overdueInvoices: { count: 2, totalCents: 150075 } });
    expect(composeBriefing(nzd).headline).toBe("2 invoices are overdue, totalling $1,500.75.");
    expect(composeBriefing(nzd, (cents) => `NZ$${cents / 100}`).headline).toBe(
      "2 invoices are overdue, totalling NZ$1500.75.",
    );
  });

  it("only ever prints figures that are in the facts", () => {
    const briefing = composeBriefing(full);
    const printed = [briefing.headline, ...briefing.items.map((item) => item.text)]
      .join(" ")
      // The window length and the quarter label are fixed wording, not figures.
      .replaceAll("next 7 days", "")
      .replaceAll("2026-Q1", "")
      .match(/\d[\d,.]*\d|\d/g);
    const allowed = new Set(["1", "2", "100.00", "200.00", "300.00", "400.00", "50.00"]);
    expect(printed!.every((figure) => allowed.has(figure))).toBe(true);
  });
});
