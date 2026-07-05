import { describe, expect, it } from "vitest";
import {
  invoiceLink,
  invoiceOverdueEmail,
  invoicePaidEmail,
  invoiceSentEmail,
  type InvoiceEmailMeta,
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
    expect(subject).toBe("Invoice INV-2026-0007 from soletrade labs");
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
    expect(text).toMatch(/was due .+Aug.+2026/);
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
