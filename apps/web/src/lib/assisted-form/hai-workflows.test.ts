import { describe, expect, it } from "vitest";
import {
  createHaiFormDirective,
  createHaiNavigationDirective,
  haiOpenFormInputSchema,
  parseMockHaiAction,
} from "@/lib/assisted-form/hai-workflows";

describe("hAI safe workflow registry", () => {
  it("turns an invoice request into a safe, unsaved form directive", () => {
    const input = haiOpenFormInputSchema.parse({
      workflow: "invoice.create",
      requestSummary: "Draft an invoice for Acme for $250",
      fields: {
        customerQuery: "Acme",
        lineItems: [{ quantity: 1, unitPriceCents: 25_000 }],
      },
    });
    const directive = createHaiFormDirective(input);

    expect(directive.href).toBe("/invoices/new");
    expect(directive.providedFields).toEqual(["customer", "line items"]);
    expect(directive.missingFields).toEqual([]);
    expect(directive.fields).toMatchObject({
      customerQuery: "Acme",
      lineItems: [{ quantity: 1, unitPriceCents: 25_000 }],
    });
    expect(directive).not.toHaveProperty("saved");
  });

  it("rejects fields outside a form's allow-list", () => {
    const parsed = haiOpenFormInputSchema.safeParse({
      workflow: "invoice.create",
      requestSummary: "Draft and send an invoice",
      fields: { sendImmediately: true },
    });
    expect(parsed.success).toBe(false);
  });

  it("surfaces required fields that were not confidently extracted", () => {
    const directive = createHaiFormDirective(
      haiOpenFormInputSchema.parse({
        workflow: "books.transaction.create",
        requestSummary: "Record an expense",
        fields: { type: "expense" },
      }),
    );
    expect(directive.missingFields).toEqual(["amount", "description"]);
  });

  it("builds exact safe navigation targets including tabs and filters", () => {
    expect(createHaiNavigationDirective("drive-trips").href).toBe("/drive?view=trips");
    expect(createHaiNavigationDirective("invoices-overdue").href).toBe("/invoices?status=overdue");
  });

  it("supports the requested invoice example in the no-key mock provider", () => {
    const action = parseMockHaiAction("Draft an invoice for Acme Pty Ltd for $1,250.50");
    expect(action).toMatchObject({
      kind: "form",
      input: {
        workflow: "invoice.create",
        fields: {
          customerQuery: "Acme Pty Ltd",
          lineItems: [{ quantity: 1, unitPriceCents: 125_050 }],
        },
      },
    });
  });

  it("prefers the specific vehicle-expenses destination over the vehicles page", () => {
    expect(parseMockHaiAction("Open vehicle expenses")).toEqual({
      kind: "navigate",
      destination: "drive-expenses",
    });
  });
});
