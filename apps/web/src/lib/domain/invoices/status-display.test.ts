// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  INVOICE_PUBLIC_STATUS_DISPLAY,
  INVOICE_STATUS_DISPLAY,
} from "@/lib/domain/invoices/status-display";
import {
  QUOTE_PUBLIC_STATUS_DISPLAY,
  QUOTE_STATUS_DISPLAY,
} from "@/lib/domain/quotes/status-display";

describe("document status display", () => {
  it("uses the same colour for a status on the staff and customer views", () => {
    for (const status of Object.keys(
      INVOICE_STATUS_DISPLAY,
    ) as (keyof typeof INVOICE_STATUS_DISPLAY)[]) {
      expect(INVOICE_PUBLIC_STATUS_DISPLAY[status].variant, status).toBe(
        INVOICE_STATUS_DISPLAY[status].variant,
      );
    }
  });

  it("follows the design system's status colours", () => {
    expect(INVOICE_STATUS_DISPLAY.paid.variant).toBe("success");
    expect(INVOICE_STATUS_DISPLAY.overdue.variant).toBe("destructive");
    expect(INVOICE_STATUS_DISPLAY.sent.variant).toBe("warning");
    expect(INVOICE_STATUS_DISPLAY.draft.variant).toBe("secondary");
    expect(QUOTE_STATUS_DISPLAY.accepted.variant).toBe("success");
    expect(QUOTE_STATUS_DISPLAY.declined.variant).toBe("destructive");
  });

  it("does not show a void invoice as if it were overdue", () => {
    expect(INVOICE_STATUS_DISPLAY.void.variant).not.toBe(INVOICE_STATUS_DISPLAY.overdue.variant);
  });

  it("tells staff when a customer has opened a document", () => {
    expect(INVOICE_STATUS_DISPLAY.viewed.label).toBe("Viewed");
    expect(QUOTE_STATUS_DISPLAY.viewed.label).toBe("Viewed");
  });

  it("shows a converted quote to the customer as accepted, not as jargon", () => {
    expect(QUOTE_PUBLIC_STATUS_DISPLAY.converted).toEqual(QUOTE_PUBLIC_STATUS_DISPLAY.accepted);
    expect(QUOTE_STATUS_DISPLAY.converted.label).toBe("Converted");
  });
});
