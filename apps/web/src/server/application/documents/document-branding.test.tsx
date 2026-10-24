import { inflateSync } from "node:zlib";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { renderPdf } from "@/server/infrastructure/pdf";
import {
  InvoiceDocument,
  type InvoicePdfData,
} from "@/server/domains/invoices/documents/invoice-document";
import { QuoteDocument, type QuotePdfData } from "@/server/domains/quotes/documents/quote-document";

const merchant = "Harbour Studio";

async function renderDocument(element: Parameters<typeof renderPdf>[0]) {
  let buffer!: Buffer;
  await act(async () => {
    buffer = await renderPdf(element);
  });
  return buffer;
}

function invoice(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    number: "INV-DEMO-001",
    status: "sent",
    issueDate: new Date("2026-10-01T00:00:00Z"),
    dueDate: new Date("2026-10-15T00:00:00Z"),
    currency: "AUD",
    taxRate: 10,
    pricesIncludeTax: false,
    subtotalCents: 25000,
    taxCents: 2500,
    totalCents: 27500,
    notes: "Please use the invoice number as the payment reference.",
    customerName: "Example Customer",
    lineItems: [
      {
        id: "item-1",
        description: "Design services",
        quantity: 1,
        unitPriceCents: 25000,
        amountCents: 25000,
      },
    ],
    paymentMethods: [
      {
        type: "bank_transfer",
        accountName: merchant,
        bsb: "000-000",
        accountNumber: "000123456",
        reference: "INV-DEMO-001",
      },
    ],
    ...overrides,
  };
}

function quote(overrides: Partial<QuotePdfData> = {}): QuotePdfData {
  return {
    number: "QUO-DEMO-001",
    status: "sent",
    issueDate: new Date("2026-10-01T00:00:00Z"),
    validUntil: new Date("2026-10-31T00:00:00Z"),
    currency: "AUD",
    taxRate: 10,
    pricesIncludeTax: false,
    subtotalCents: 18000,
    taxCents: 1800,
    totalCents: 19800,
    notes: "We look forward to working with you.",
    termsConditions: "Payment is due within 14 days of invoicing.",
    customerName: "Example Customer",
    lineItems: [
      {
        id: "item-1",
        description: "Design consultation",
        quantity: 1,
        unitPriceCents: 18000,
        amountCents: 18000,
      },
    ],
    sections: [
      { id: "scope", title: "Scope", body: "Project discovery and design.", optional: false },
    ],
    ...overrides,
  };
}

/** Read the writer's built-in Helvetica text streams; this is not a general PDF parser. */
function renderedContent(buffer: Buffer) {
  const source = buffer.toString("latin1");
  const strings: string[] = [];
  for (const match of source.matchAll(/\bstream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    if (!match[1]) continue;
    let stream = match[1];
    try {
      stream = inflateSync(Buffer.from(stream, "latin1")).toString("latin1");
    } catch {
      // Some PDF streams are uncompressed.
    }
    for (const encoded of stream.matchAll(/<([\da-f]+)>/gi)) {
      if (encoded[1]) strings.push(Buffer.from(encoded[1], "hex").toString("latin1"));
    }
  }
  return {
    source,
    text: strings.join(""),
    pages: [...source.matchAll(/\/Type\s*\/Page\b/g)].length,
  };
}

describe("merchant PDF branding", () => {
  it("renders HB product branding and parent attribution without changing the invoice issuer", async () => {
    const buffer = await renderDocument(
      <InvoiceDocument invoice={invoice()} workspaceName={merchant} />,
    );
    const pdf = renderedContent(buffer);

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.text).toContain("Soletrade");
    expect(pdf.text).toContain("Matt Haitana");
    expect(pdf.text).toContain(merchant);
    expect(pdf.text).toContain("Example Customer");
    expect(pdf.text).toContain("AUD 275.00");
    expect(pdf.text).toContain("000123456");
    expect(pdf.text).toContain("Please use the invoice number as the payment reference.");
    expect(pdf.source).toContain("(Harbour Studio)");
    expect(pdf.source).toContain("(Soletrade)");
    expect(pdf.source).toContain("(Matt Haitana)");
  });

  it("renders HB product branding while retaining the quote scope, totals and terms", async () => {
    const pdf = renderedContent(
      await renderDocument(<QuoteDocument quote={quote()} workspaceName={merchant} />),
    );

    expect(pdf.text).toContain("Soletrade");
    expect(pdf.text).toContain("Matt Haitana");
    expect(pdf.text).toContain(merchant);
    expect(pdf.text).toContain("AUD 198.00");
    expect(pdf.text).toContain("Project discovery and design.");
    expect(pdf.text).toContain("Payment is due within 14 days of invoicing.");
    expect(pdf.source).toContain("(Harbour Studio)");
    expect(pdf.source).toContain("(Soletrade)");
    expect(pdf.source).toContain("(Matt Haitana)");
  });

  it("keeps parent attribution on every page of a long invoice", async () => {
    const lineItems = Array.from({ length: 70 }, (_, i) => ({
      id: `item-${i}`,
      description: `Service line ${i + 1}`,
      quantity: 1,
      unitPriceCents: 1000,
      amountCents: 1000,
    }));
    const pdf = renderedContent(
      await renderDocument(
        <InvoiceDocument
          invoice={invoice({ lineItems, subtotalCents: 70000, taxCents: 7000, totalCents: 77000 })}
          workspaceName={merchant}
        />,
      ),
    );

    expect(pdf.pages).toBeGreaterThan(1);
    expect(pdf.text).toContain("Service line 70");
    expect(pdf.text).toContain("AUD 770.00");
    expect(pdf.text.match(/Matt Haitana/g)?.length).toBe(pdf.pages);
    expect(pdf.text).toContain("000123456");
  });

  it("keeps parent attribution and final terms on a multi-page quote", async () => {
    const sections = Array.from({ length: 12 }, (_, i) => ({
      id: `section-${i}`,
      title: `Scope section ${i + 1}`,
      body: "Detailed project deliverables and acceptance criteria. ".repeat(25),
      optional: false,
    }));
    const pdf = renderedContent(
      await renderDocument(<QuoteDocument quote={quote({ sections })} workspaceName={merchant} />),
    );

    expect(pdf.pages).toBeGreaterThan(1);
    expect(pdf.text).toContain("Scope section 12");
    expect(pdf.text).toContain("Payment is due within 14 days of invoicing.");
    expect(pdf.text.match(/Matt Haitana/g)?.length).toBe(pdf.pages);
  });
});
