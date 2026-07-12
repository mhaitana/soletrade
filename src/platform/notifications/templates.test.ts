import { describe, expect, it } from "vitest";
import {
  invoiceLink,
  invoiceOverdueEmail,
  invoicePaidEmail,
  invoiceSentEmail,
  quoteAcceptedEmail,
  quoteDeclinedEmail,
  quoteLink,
  quoteSentEmail,
  type InvoiceEmailMeta,
  type QuoteEmailMeta,
  type QuoteMerchantMeta,
} from "./templates";

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
    expect(html).toContain("AUD 250.00");
    expect(text).toContain("AUD 250.00");
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
    expect(text).toContain("AUD 250.00");
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

describe("quoteSentEmail", () => {
  it("includes the quote number in the subject + a working view link in both bodies", () => {
    const m = quoteMeta();
    const { subject, html, text } = quoteSentEmail(m, APP_URL);
    expect(subject).toBe("Quote QUO-2026-0003");
    expect(text).toContain(`${APP_URL}/q/quo-token-xyz`);
    expect(html).toContain(`href="${APP_URL}/q/quo-token-xyz"`);
    expect(html).toContain("View quote");
    expect(html).toContain("AUD 180.00");
    expect(text).toContain("AUD 180.00");
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
    expect(text).toContain("AUD 180.00");
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
    expect(text).toContain("AUD 180.00");
    expect(text).toContain("from Globex Corp");
  });
});
