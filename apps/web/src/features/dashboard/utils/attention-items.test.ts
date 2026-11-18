import { describe, expect, it } from "vitest";
import type { InsightFacts } from "@/lib/domain/insights/facts";
import { buildAttentionItems } from "@/features/dashboard/utils/attention-items";

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

describe("buildAttentionItems", () => {
  it("shows the same four entries, wording and order the dashboard has always shown", () => {
    const items = buildAttentionItems(
      facts({
        overdueInvoices: { count: 2, totalCents: 35050 },
        acceptedQuotes: { count: 3, totalCents: 1234500 },
        receiptsToReview: { count: 137 },
        draftInvoices: { count: 4 },
      }),
    );
    expect(items).toEqual([
      {
        id: "overdue-invoices",
        title: "2 overdue invoices",
        detail: "$350.50 is past due and may need a follow-up.",
        href: "/invoices?status=overdue",
        actionLabel: "Review overdue",
        tone: "danger",
        icon: "invoice",
      },
      {
        id: "accepted-quotes",
        title: "3 accepted quotes are ready to invoice",
        detail: "$12,345.00 of approved work is waiting to be converted.",
        href: "/quotes?status=accepted",
        actionLabel: "Create invoices",
        tone: "info",
        icon: "quote",
      },
      {
        id: "pending-receipts",
        title: "137 receipts need review",
        detail: "Confirm the extracted details before adding them to your books.",
        href: "/books/receipts?status=pending",
        actionLabel: "Review receipts",
        tone: "warning",
        icon: "receipt",
      },
      {
        id: "draft-invoices",
        title: "4 draft invoices",
        detail: "Finish or remove drafts so your invoice list reflects active work.",
        href: "/invoices?status=draft",
        actionLabel: "Finish drafts",
        tone: "neutral",
        icon: "draft",
      },
    ]);
  });

  it("uses singular wording for one of each", () => {
    const titles = buildAttentionItems(
      facts({
        overdueInvoices: { count: 1, totalCents: 100 },
        acceptedQuotes: { count: 1, totalCents: 100 },
        receiptsToReview: { count: 1 },
        draftInvoices: { count: 1 },
      }),
    ).map((item) => item.title);
    expect(titles).toEqual([
      "1 overdue invoice",
      "1 accepted quote is ready to invoice",
      "1 receipt needs review",
      "1 draft invoice",
    ]);
  });

  it("is empty when nothing is waiting or the member can see no area", () => {
    expect(buildAttentionItems(facts())).toEqual([]);
    expect(
      buildAttentionItems(
        facts({
          overdueInvoices: null,
          draftInvoices: null,
          acceptedQuotes: null,
          receiptsToReview: null,
        }),
      ),
    ).toEqual([]);
  });

  it("does not add entries for the facts only the briefing shows", () => {
    const items = buildAttentionItems(
      facts({
        invoicesDueSoon: { count: 5, totalCents: 50000 },
        quotesExpiringSoon: { count: 2, totalCents: 20000 },
        gstToLodge: { periodLabel: "2026-Q1", netGstCents: 123400 },
      }),
    );
    expect(items).toEqual([]);
  });

  it("formats totals in the workspace currency", () => {
    const [item] = buildAttentionItems(
      facts({ currency: "EUR", overdueInvoices: { count: 1, totalCents: 99900 } }),
    );
    expect(item!.detail).toBe("€999.00 is past due and may need a follow-up.");
  });
});
