import { describe, expect, it } from "vitest";
import {
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
