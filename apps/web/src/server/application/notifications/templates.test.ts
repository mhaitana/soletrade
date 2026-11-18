import { describe, expect, it } from "vitest";
import {
  briefingDigestEmail,
  inviteLink,
  invoiceLink,
  invoiceOverdueEmail,
  invoicePaidEmail,
  invoiceSentEmail,
  memberInvitedEmail,
  quoteAcceptedEmail,
  quoteDeclinedEmail,
  quoteLink,
  quoteSentEmail,
  refundIssuedEmail,
} from "@/server/application/notifications/templates";
import {
  type BriefingDigestEmailMeta,
  type InvoiceEmailMeta,
  type QuoteEmailMeta,
  type QuoteMerchantMeta,
} from "@/lib/domain/notifications/email-types";
import { urls } from "@/config/urls";

const APP_URL = "https://app.soletrade.example";

function meta(overrides: Partial<InvoiceEmailMeta> = {}): InvoiceEmailMeta {
  return {
    number: "INV-2026-0007",
    totalCents: 25000,
    currency: "AUD",
    customerEmail: "customer@globex.com",
    customerName: "Globex Corp",
    customerId: null,
    publicToken: "abc-123-token",
    dueDate: new Date("2026-08-01"),
    ...overrides,
  };
}

describe("invoiceLink", () => {
  it("builds the absolute public page URL, stripping a trailing slash", () => {
    expect(invoiceLink("tok", "https://app.example.com")).toBe("https://app.example.com/i/tok");
    expect(invoiceLink("tok", "https://app.example.com/")).toBe("https://app.example.com/i/tok");
  });
});

describe("invoiceSentEmail", () => {
  it("includes the invoice number in the subject + a working pay link in both bodies", () => {
    const m = meta();
    const { subject, html, text } = invoiceSentEmail(m, APP_URL);
    expect(subject).toBe("Invoice INV-2026-0007");
    expect(text).toContain(`${APP_URL}/i/abc-123-token`);
    expect(html).toContain(`href="${APP_URL}/i/abc-123-token"`);
    expect(html).toContain("View & pay invoice");
    expect(html).toContain("$250.00 AUD");
    expect(text).toContain("$250.00 AUD");
  });

  it("greets by customer name when present, falls back to a generic greeting", () => {
    expect(invoiceSentEmail(meta(), APP_URL).text).toContain("Hi Globex Corp");
    expect(invoiceSentEmail(meta({ customerName: null }), APP_URL).text).toContain("Hello,");
  });

  it("includes the due date in subject-adjacent copy when set", () => {
    const { text } = invoiceSentEmail(meta({ dueDate: new Date("2026-08-01") }), APP_URL);
    expect(text).toMatch(/due .+Aug.+2026/);
  });
});

describe("invoiceOverdueEmail", () => {
  it("flags overdue in the subject + uses the red accent", () => {
    const m = meta();
    const { subject, html, text } = invoiceOverdueEmail(m, APP_URL);
    expect(subject).toBe("Overdue: Invoice INV-2026-0007");
    expect(html).toContain("#DC2626"); // red accent
    expect(html).toContain("Pay invoice now");
    expect(text).toContain(`${APP_URL}/i/abc-123-token`);
  });

  it("mentions the due date when set", () => {
    const { text } = invoiceOverdueEmail(meta({ dueDate: new Date("2026-08-01") }), APP_URL);
    // `.*` (not `.+`) so this matches both en-AU "1 Aug 2026" and en-US "Aug 1, 2026" -
    // formatDate uses the host locale, so the test must be day/month-order agnostic.
    expect(text).toMatch(/was due .*Aug.*2026/);
  });
});

describe("invoicePaidEmail", () => {
  it("uses the emerald accent and a view-invoice CTA", () => {
    const m = { ...meta(), source: "stripe" as const };
    const { subject, html, text } = invoicePaidEmail(m, APP_URL);
    expect(subject).toBe("Receipt: Invoice INV-2026-0007");
    expect(html).toContain("#059669"); // emerald accent
    expect(html).toContain("View invoice");
    expect(text).toContain("$250.00 AUD");
    expect(text).toContain(`${APP_URL}/i/abc-123-token`);
  });

  it("accepts both stripe and manual sources without changing the rendered shape", () => {
    const a = invoicePaidEmail({ ...meta(), source: "stripe" }, APP_URL);
    const b = invoicePaidEmail({ ...meta(), source: "manual" }, APP_URL);
    expect(a.subject).toBe(b.subject);
    expect(a.html).toBe(b.html);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 - quote email templates
// ─────────────────────────────────────────────────────────────────────────────

function quoteMeta(overrides: Partial<QuoteEmailMeta> = {}): QuoteEmailMeta {
  return {
    number: "QUO-2026-0003",
    totalCents: 18000,
    currency: "AUD",
    publicToken: "quo-token-xyz",
    validUntil: new Date("2026-08-15"),
    customerEmail: "customer@globex.com",
    customerName: "Globex Corp",
    customerId: null,
    ...overrides,
  };
}

function merchantMeta(overrides: Partial<QuoteMerchantMeta> = {}): QuoteMerchantMeta {
  return {
    number: "QUO-2026-0003",
    totalCents: 18000,
    currency: "AUD",
    customerName: "Globex Corp",
    customerEmail: "customer@globex.com",
    ...overrides,
  };
}

describe("quoteLink", () => {
  it("builds the absolute public page URL, stripping a trailing slash", () => {
    expect(quoteLink("tok", "https://app.example.com")).toBe("https://app.example.com/q/tok");
    expect(quoteLink("tok", "https://app.example.com/")).toBe("https://app.example.com/q/tok");
  });
});

describe("customer emails name the sending business", () => {
  it("puts the business in the subject and body of invoice emails when it is known", () => {
    const m = { ...meta(), merchantName: "Acme Plumbing" };
    expect(invoiceSentEmail(m, APP_URL).subject).toBe("Invoice INV-2026-0007 from Acme Plumbing");
    expect(invoiceSentEmail(m, APP_URL).text).toContain(
      "You have a new invoice (INV-2026-0007) from Acme Plumbing.",
    );
    expect(invoiceOverdueEmail(m, APP_URL).subject).toBe(
      "Overdue: Invoice INV-2026-0007 from Acme Plumbing",
    );
    expect(invoicePaidEmail({ ...m, source: "manual" }, APP_URL).html).toContain(
      "Acme Plumbing has received your payment",
    );
  });

  it("puts the business in quote emails", () => {
    const email = quoteSentEmail({ ...quoteMeta(), merchantName: "Acme Plumbing" }, APP_URL);
    expect(email.subject).toBe("Quote QUO-2026-0003 from Acme Plumbing");
    expect(email.html).toContain("from Acme Plumbing");
  });

  it("keeps the generic wording when the business name is unavailable", () => {
    expect(invoiceSentEmail({ ...meta(), merchantName: null }, APP_URL).subject).toBe(
      "Invoice INV-2026-0007",
    );
    expect(invoiceSentEmail({ ...meta(), merchantName: "   " }, APP_URL).subject).toBe(
      "Invoice INV-2026-0007",
    );
  });

  it("escapes names placed into the HTML body", () => {
    const email = invoiceSentEmail(
      { ...meta(), customerName: "Smith & <Sons>", merchantName: 'Bob\'s "Best" <Builders>' },
      APP_URL,
    );
    expect(email.html).toContain("Hi Smith &amp; &lt;Sons&gt;,");
    expect(email.html).toContain("from Bob&#39;s &quot;Best&quot; &lt;Builders&gt;");
    expect(email.html).not.toContain("<Sons>");
    expect(email.html).not.toContain("<Builders>");
    // Plain-text part and subject are not HTML and stay as written.
    expect(email.subject).toBe('Invoice INV-2026-0007 from Bob\'s "Best" <Builders>');
  });

  it("formats money with thousands separators and the currency code", () => {
    const email = invoiceSentEmail({ ...meta(), totalCents: 1234567 }, APP_URL);
    expect(email.text).toContain("$12,345.67 AUD");
  });
});

describe("inviteLink", () => {
  it("points at the path-based accept route that exists (app/invite/[token])", () => {
    expect(inviteLink("abc-123", "https://app.example.com")).toBe(
      "https://app.example.com/invite/abc-123",
    );
    expect(inviteLink("abc-123", "https://app.example.com/")).toBe(
      "https://app.example.com/invite/abc-123",
    );
    expect(inviteLink("a b/c", "https://app.example.com")).toBe(
      "https://app.example.com/invite/a%20b%2Fc",
    );
  });

  it("is the link the invitation email sends", () => {
    const email = memberInvitedEmail(
      {
        email: "m@example.com",
        role: "employee",
        token: "tok-1",
        workspaceName: "Acme",
        inviterName: null,
      },
      "https://app.example.com",
    );
    expect(email.html).toContain('href="https://app.example.com/invite/tok-1"');
    expect(email.text).toContain("https://app.example.com/invite/tok-1");
    expect(email.html).not.toContain("/invite?token=");
  });
});

describe("quoteSentEmail", () => {
  it("includes the quote number in the subject + a working view link in both bodies", () => {
    const m = quoteMeta();
    const { subject, html, text } = quoteSentEmail(m, APP_URL);
    expect(subject).toBe("Quote QUO-2026-0003");
    expect(text).toContain(`${APP_URL}/q/quo-token-xyz`);
    expect(html).toContain(`href="${APP_URL}/q/quo-token-xyz"`);
    expect(html).toContain("View quote");
    expect(html).toContain("$180.00 AUD");
    expect(text).toContain("$180.00 AUD");
  });

  it("greets by customer name when present, falls back to a generic greeting", () => {
    expect(quoteSentEmail(quoteMeta(), APP_URL).text).toContain("Hi Globex Corp");
    expect(quoteSentEmail(quoteMeta({ customerName: null }), APP_URL).text).toContain("Hello,");
  });

  it("mentions the valid-until date when set", () => {
    const { text } = quoteSentEmail(quoteMeta({ validUntil: new Date("2026-08-15") }), APP_URL);
    // `.*` (not `.+`) - formatDate uses the host locale, so accept either day/month order.
    expect(text).toMatch(/valid until .*Aug.*2026/);
  });
});

describe("quoteAcceptedEmail", () => {
  it("uses the emerald accent and is informational (no button)", () => {
    const m = merchantMeta();
    const { subject, html, text } = quoteAcceptedEmail(m);
    expect(subject).toBe("Quote QUO-2026-0003 accepted");
    expect(html).toContain("#059669"); // emerald accent
    expect(html).toContain("A quote was accepted");
    expect(html).not.toContain("View quote"); // merchant notifications have no button
    expect(text).toContain("$180.00 AUD");
    expect(text).toContain("from Globex Corp");
  });
});

describe("quoteDeclinedEmail", () => {
  it("uses the red accent and is informational (no button)", () => {
    const m = merchantMeta();
    const { subject, html, text } = quoteDeclinedEmail(m);
    expect(subject).toBe("Quote QUO-2026-0003 declined");
    expect(html).toContain("#DC2626"); // red accent
    expect(html).toContain("A quote was declined");
    expect(html).not.toContain("View quote");
    expect(text).toContain("$180.00 AUD");
    expect(text).toContain("from Globex Corp");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hAI Wave 5 - briefing digest email
// ─────────────────────────────────────────────────────────────────────────────

function digestMeta(overrides: Partial<BriefingDigestEmailMeta> = {}): BriefingDigestEmailMeta {
  return {
    workspaceName: "Acme Plumbing",
    frequency: "daily",
    facts: {
      // 07:07 on 19 November 2026 in Sydney.
      asOf: "2026-11-18T20:07:00.000Z",
      today: "2026-11-19",
      timezone: "Australia/Sydney",
      currency: "AUD",
      overdueInvoices: { count: 3, totalCents: 450000 },
      invoicesDueSoon: { count: 2, totalCents: 120000 },
      draftInvoices: { count: 1 },
      acceptedQuotes: { count: 1, totalCents: 90000 },
      quotesExpiringSoon: { count: 2, totalCents: 300000 },
      receiptsToReview: { count: 4 },
      gstToLodge: { periodLabel: "2026-Q1", netGstCents: 123400 },
    },
    ...overrides,
  };
}

describe("briefingDigestEmail", () => {
  it("names the workspace and the frequency in the subject", () => {
    expect(briefingDigestEmail(digestMeta(), APP_URL).subject).toBe(
      "Your daily briefing for Acme Plumbing",
    );
    expect(briefingDigestEmail(digestMeta({ frequency: "weekly" }), APP_URL).subject).toBe(
      "Your weekly briefing for Acme Plumbing",
    );
  });

  it("states each fact with its total and a link into the app", () => {
    const { text, html } = briefingDigestEmail(digestMeta(), APP_URL);
    const lines = [
      ["3 invoices are overdue, totalling $4,500.00 AUD.", "/invoices?status=overdue"],
      ["2 invoices are due in the next 7 days, totalling $1,200.00 AUD.", "/invoices"],
      ["1 accepted quote is ready to invoice, worth $900.00 AUD.", "/quotes?status=accepted"],
      ["2 quotes expire in the next 7 days, worth $3,000.00 AUD.", "/quotes"],
      ["4 receipts need review.", "/books/receipts?status=pending"],
      ["1 draft invoice is unfinished.", "/invoices?status=draft"],
      ["GST for 2026-Q1 is not marked as lodged: $1,234.00 AUD owed.", "/books/tax"],
    ] as const;
    for (const [statement, path] of lines) {
      expect(text).toContain(`- ${statement}\n  ${APP_URL}${path}`);
      expect(html).toContain(statement);
      expect(html).toContain(`href="${APP_URL}${path}"`);
    }
    expect(html).toContain(`href="${APP_URL}/dashboard"`);
    expect(html).toContain("Open dashboard");
    expect(text).toContain(`Open your dashboard:\n${APP_URL}/dashboard`);
  });

  it("says when the facts were read, in the workspace's timezone", () => {
    const { text, html } = briefingDigestEmail(digestMeta(), APP_URL);
    expect(text).toMatch(/As of 19 Nov, 7:07 am \(Australia\/Sydney\)/i);
    expect(html).toMatch(/As of 19 Nov, 7:07 am \(Australia\/Sydney\)/i);
  });

  it("says clearly how to turn the digest off, with a link to the setting", () => {
    const daily = briefingDigestEmail(digestMeta(), APP_URL);
    const optOut =
      "You are getting this because you turned on the daily briefing digest for Acme Plumbing. " +
      "To turn it off, open Settings > hAI and set Briefing digest to Off.";
    expect(daily.text).toContain(`${optOut}\n${APP_URL}/settings/assistant`);
    const document = new DOMParser().parseFromString(daily.html, "text/html");
    expect(document.body.textContent).toContain(optOut);
    expect(document.querySelector(`a[href="${APP_URL}/settings/assistant"]`)?.textContent).toBe(
      "Open hAI settings",
    );
    expect(briefingDigestEmail(digestMeta({ frequency: "weekly" }), APP_URL).text).toContain(
      "you turned on the weekly briefing digest",
    );
  });

  it("includes only the facts this member has", () => {
    const meta = digestMeta();
    const { text, html } = briefingDigestEmail(
      {
        ...meta,
        facts: {
          ...meta.facts,
          overdueInvoices: { count: 1, totalCents: 9900 },
          invoicesDueSoon: { count: 0, totalCents: 0 },
          draftInvoices: { count: 0 },
          acceptedQuotes: null,
          quotesExpiringSoon: null,
          receiptsToReview: null,
          gstToLodge: null,
        },
      },
      APP_URL,
    );
    expect(text).toContain("- 1 invoice is overdue, totalling $99.00 AUD.");
    expect(text.match(/^- /gm)).toHaveLength(1);
    for (const absent of ["quote", "receipt", "GST", "draft"]) {
      expect(text).not.toContain(absent);
      expect(html).not.toContain(absent);
    }
  });

  it("prints no figure that is not one of the facts", () => {
    const { text } = briefingDigestEmail(digestMeta(), APP_URL);
    const figures = text
      // Fixed wording, the timestamp line and the quarter label are not figures.
      .replace(/^As of .*$/m, "")
      .replaceAll("next 7 days", "")
      .replaceAll("2026-Q1", "")
      .match(/\d[\d,.]*\d|\d/g);
    const allowed = new Set([
      "3",
      "4,500.00",
      "2",
      "1,200.00",
      "1",
      "900.00",
      "3,000.00",
      "4",
      "1,234.00",
    ]);
    expect(figures!.filter((figure) => !allowed.has(figure))).toEqual([]);
  });

  it("escapes the workspace name in HTML and keeps it as written elsewhere", () => {
    const email = briefingDigestEmail(
      digestMeta({ workspaceName: 'Smith & <Sons> "Plumbing"' }),
      APP_URL,
    );
    expect(email.html).toContain("Smith &amp; &lt;Sons&gt; &quot;Plumbing&quot;");
    expect(email.html).not.toContain("<Sons>");
    expect(email.subject).toBe('Your daily briefing for Smith & <Sons> "Plumbing"');
    expect(email.text).toContain('briefing digest for Smith & <Sons> "Plumbing"');
  });

  it("builds links from the deployment origin, with or without a trailing slash", () => {
    const email = briefingDigestEmail(digestMeta(), "https://tenant.example.com/");
    expect(email.text).toContain("https://tenant.example.com/invoices?status=overdue");
    expect(email.text).toContain("https://tenant.example.com/settings/assistant");
    expect(email.text).not.toContain("example.com//");
  });
});

describe("HB email branding", () => {
  const cases = [
    ["invoice sent", () => invoiceSentEmail(meta(), APP_URL)],
    ["invoice overdue", () => invoiceOverdueEmail(meta(), APP_URL)],
    ["invoice paid", () => invoicePaidEmail({ ...meta(), source: "stripe" }, APP_URL)],
    ["quote sent", () => quoteSentEmail(quoteMeta(), APP_URL)],
    ["quote accepted", () => quoteAcceptedEmail(merchantMeta(), APP_URL)],
    ["quote declined", () => quoteDeclinedEmail(merchantMeta(), APP_URL)],
    [
      "member invited",
      () =>
        memberInvitedEmail(
          {
            email: "member@example.com",
            role: "employee",
            token: "sample-invitation",
            workspaceName: "Example Studio",
            inviterName: "Alex",
          },
          APP_URL,
        ),
    ],
    [
      "refund issued",
      () =>
        refundIssuedEmail(
          {
            amountCents: 900,
            currency: "AUD",
            reason: "Module cancelled",
            moduleKey: "books",
            method: "card",
          },
          APP_URL,
        ),
    ],
    ["briefing digest", () => briefingDigestEmail(digestMeta(), APP_URL)],
  ] as const;

  it.each(cases)(
    "brands %s with the HB image, product name and parent attribution",
    (_, render) => {
      const email = render();
      const document = new DOMParser().parseFromString(email.html, "text/html");
      const logo = document.querySelector("img");

      expect(logo).not.toBeNull();
      expect(logo?.getAttribute("src")).toBe(
        `${APP_URL}/icons/soletrade-v1/icon-192x192.png`,
      );
      expect(logo?.getAttribute("width")).toBe("40");
      expect(logo?.getAttribute("height")).toBe("40");
      expect(logo?.getAttribute("alt")).toBe("");
      expect(logo?.closest("tr")?.textContent).toContain("Soletrade");
      expect(logo?.closest("tr")?.textContent).not.toContain("Matt Haitana");
      expect(document.body.textContent).toContain("© Matt Haitana");
      expect(email.text).toMatch(/Soletrade\n© Matt Haitana$/);
      expect(email.html).not.toContain("<svg");
      expect(email.html).not.toMatch(/display:\s*(flex|grid)/);
    },
  );

  it("uses the supplied deployment origin for the logo when the app URL has a path", () => {
    const email = invoiceSentEmail(meta(), "https://tenant.example.com/app/");
    const document = new DOMParser().parseFromString(email.html, "text/html");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      "https://tenant.example.com/icons/soletrade-v1/icon-192x192.png",
    );
    expect(email.html).toContain('href="https://tenant.example.com/app/i/abc-123-token"');
  });

  it("defaults informational emails to the configured application origin", () => {
    const email = quoteAcceptedEmail(merchantMeta());
    const document = new DOMParser().parseFromString(email.html, "text/html");
    expect(document.querySelector("img")?.getAttribute("src")).toBe(
      `${new URL(urls.app).origin}/icons/soletrade-v1/icon-192x192.png`,
    );
  });
});
