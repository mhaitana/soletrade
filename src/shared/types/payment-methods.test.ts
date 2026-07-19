import { describe, it, expect } from "vitest";
import {
  paymentMethodSchema,
  paymentMethodsSchema,
  parsePaymentMethods,
  resolveInvoicePaymentMethods,
  getPaymentMethodLabel,
  getPaymentMethodDetails,
  type PaymentMethod,
} from "./payment-methods";

const bank: PaymentMethod = {
  type: "bank_transfer",
  accountName: "Acme Labs",
  bsb: "062-000",
  accountNumber: "12345678",
  bankName: "Commonwealth Bank",
  reference: "INV-2026-0001",
};

const paypal: PaymentMethod = { type: "paypal", email: "pay@acme.com" };
const payid: PaymentMethod = { type: "payid", identifier: "pay@acme.com" };

describe("payment-methods", () => {
  it("validates bank transfer details", () => {
    expect(paymentMethodSchema.safeParse(bank).success).toBe(true);
  });

  it("rejects invalid PayPal email", () => {
    const result = paymentMethodSchema.safeParse({ type: "paypal", email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("limits the number of methods", () => {
    const methods = Array.from({ length: 11 }, (_, i) => ({
      type: "payid" as const,
      identifier: `id${i}@x.com`,
    }));
    const result = paymentMethodsSchema.safeParse(methods);
    expect(result.success).toBe(false);
  });

  it("returns default labels when label omitted", () => {
    expect(getPaymentMethodLabel(bank)).toBe("Bank transfer");
    expect(getPaymentMethodLabel(paypal)).toBe("PayPal");
    expect(getPaymentMethodLabel(payid)).toBe("PayID");
  });

  it("uses custom labels when provided", () => {
    const method = { ...bank, label: "Direct deposit" };
    expect(getPaymentMethodLabel(method)).toBe("Direct deposit");
  });

  it("renders bank transfer details", () => {
    const lines = getPaymentMethodDetails(bank);
    expect(lines).toEqual([
      { label: "Account name", value: "Acme Labs" },
      { label: "BSB", value: "062-000" },
      { label: "Account number", value: "12345678" },
      { label: "Bank", value: "Commonwealth Bank" },
      { label: "Reference", value: "INV-2026-0001" },
    ]);
  });

  it("renders PayPal and PayID details", () => {
    expect(getPaymentMethodDetails(paypal)).toEqual([
      { label: "PayPal email", value: "pay@acme.com" },
    ]);
    expect(getPaymentMethodDetails(payid)).toEqual([{ label: "PayID", value: "pay@acme.com" }]);
  });

  it("parses null/undefined as empty list", () => {
    expect(parsePaymentMethods(null)).toEqual({ ok: true, methods: [] });
    expect(parsePaymentMethods(undefined)).toEqual({ ok: true, methods: [] });
  });

  it("rejects malformed jsonb", () => {
    const result = parsePaymentMethods([{ type: "bank_transfer" }]);
    expect(result.ok).toBe(false);
  });

  it("resolves invoice override over workspace default", () => {
    const workspace = [bank];
    const invoice = [paypal];
    expect(resolveInvoicePaymentMethods(invoice, workspace)).toEqual(invoice);
  });

  it("falls back to workspace default when invoice list is empty", () => {
    expect(resolveInvoicePaymentMethods([], [bank])).toEqual([bank]);
  });

  it("falls back to workspace default when invoice list is invalid", () => {
    expect(resolveInvoicePaymentMethods([{ type: "unknown" }], [bank])).toEqual([bank]);
  });

  it("returns empty list when both are empty", () => {
    expect(resolveInvoicePaymentMethods(null, [])).toEqual([]);
  });
});
