import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { InvoiceForm } from "./invoices-form";
import { createHaiFormDirective, haiOpenFormInputSchema } from "../assistant/hai-workflows";
import { storeHaiFormDirective } from "../assistant/hai-form-prefill";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const createInvoiceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("./actions", () => ({
  createInvoiceAction: (...args: unknown[]) => createInvoiceMock(...args),
  updateInvoiceAction: vi.fn(),
}));

vi.mock("../customers/customer-create-dialog", () => ({
  CustomerCreateDialog: () => null,
}));

describe("InvoiceForm hAI assisted draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  it("prefills reliable values without calling the create action", async () => {
    storeHaiFormDirective(
      createHaiFormDirective(
        haiOpenFormInputSchema.parse({
          workflow: "invoice.create",
          requestSummary: "Draft an invoice for Acme for $250",
          fields: {
            customerQuery: "Acme",
            lineItems: [{ quantity: 1, unitPriceCents: 25_000 }],
          },
        }),
      ),
    );

    render(
      <InvoiceForm
        mode="create"
        customers={[
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Acme",
            email: "billing@acme.test",
            company: "Acme Pty Ltd",
          },
        ]}
        workspacePaymentMethods={[]}
        defaultCurrency="AUD"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Customer")).toHaveValue("00000000-0000-4000-8000-000000000001");
      expect(screen.getByLabelText("Line 1 unit price")).toHaveValue(250);
    });
    expect(screen.getByText("hAI prepared an unsaved draft")).toBeTruthy();
    expect(screen.getByText(/nothing has been saved or sent/i)).toBeTruthy();
    expect(screen.getByText(/line-item description/i)).toBeTruthy();
    expect(createInvoiceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
