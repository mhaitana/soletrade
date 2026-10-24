import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PublicInvoicePage from "./[token]/page";
import PublicQuotePage from "../q/[token]/page";

vi.mock("@/modules/invoices", () => ({
  getInvoiceByPublicToken: vi.fn().mockResolvedValue({
    id: "inv-1",
    number: "INV-2026-0001",
    status: "sent",
    currency: "AUD",
    subtotalCents: 10000,
    taxCents: 1000,
    totalCents: 11000,
    issueDate: new Date("2026-10-25"),
    dueDate: new Date("2026-11-25"),
    merchantName: "Acme Services",
    customerName: "Jane Doe",
    customerEmail: "jane@example.com",
    taxRate: 10,
    lineItems: [
      {
        description: "Consulting service",
        quantity: 1,
        unitPriceCents: 10000,
        amountCents: 10000,
        lineTotalCents: 10000,
      },
    ],
    sections: [],
    paymentMethods: [],
  }),
  markInvoiceViewed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/modules/quotes", () => ({
  getQuoteByPublicToken: vi.fn().mockResolvedValue({
    id: "quo-1",
    number: "QUO-2026-0001",
    status: "sent",
    currency: "AUD",
    subtotalCents: 10000,
    taxCents: 1000,
    totalCents: 11000,
    issueDate: new Date("2026-10-25"),
    expiryDate: new Date("2026-11-25"),
    merchantName: "Acme Services",
    customerName: "Jane Doe",
    customerEmail: "jane@example.com",
    taxRate: 10,
    lineItems: [
      {
        description: "Consulting service",
        quantity: 1,
        unitPriceCents: 10000,
        amountCents: 10000,
        lineTotalCents: 10000,
      },
    ],
    sections: [],
  }),
  markQuoteViewed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./[token]/invoice-payment-form", () => ({
  InvoicePaymentForm: () => <div data-testid="invoice-payment-form" />,
}));

vi.mock("../q/[token]/quote-accept-form", () => ({
  QuoteAcceptForm: () => <div data-testid="quote-accept-form" />,
}));

describe("Public Document Pages (Editorial Precision)", () => {
  it("renders public invoice page with merchant prominence and tabular figures", async () => {
    const page = await PublicInvoicePage({
      params: Promise.resolve({ token: "test-token" }),
    });
    render(page);

    expect(screen.getByText("INV-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Acme Services")).toBeInTheDocument();
    const amounts = screen.getAllByText("AUD 110.00");
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) {
      expect(amount).toHaveClass("tabular-nums");
    }
  });

  it("renders public quote page with merchant prominence and tabular figures", async () => {
    const page = await PublicQuotePage({
      params: Promise.resolve({ token: "test-token" }),
    });
    render(page);

    expect(screen.getByText("QUO-2026-0001")).toBeInTheDocument();
    expect(screen.getByText("Acme Services")).toBeInTheDocument();
    const amounts = screen.getAllByText("AUD 110.00");
    expect(amounts.length).toBeGreaterThan(0);
    for (const amount of amounts) {
      expect(amount).toHaveClass("tabular-nums");
    }
  });
});
