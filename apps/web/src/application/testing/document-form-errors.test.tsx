import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceForm } from "@/application/documents/invoice-form";
import { QuoteForm } from "@/application/documents/quote-form";

const mocks = vi.hoisted(() => ({
  createInvoice: vi.fn(),
  createQuote: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/features/invoices/api/actions", () => ({
  createInvoiceAction: (...args: unknown[]) => mocks.createInvoice(...args),
  updateInvoiceAction: vi.fn(),
}));
vi.mock("@/features/quotes/api/actions", () => ({
  createQuoteAction: (...args: unknown[]) => mocks.createQuote(...args),
  updateQuoteAction: vi.fn(),
}));
vi.mock("@/features/customers/components/customer-create-dialog", () => ({
  CustomerCreateDialog: () => null,
}));

const customers = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Aster Labs",
    email: "billing@aster.test",
    company: null,
  },
];

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Customer"), customers[0]!.id);
  await user.type(screen.getByLabelText("Line 1 description"), "Consulting");
  await user.type(screen.getByLabelText("Line 1 unit price"), "125");
}

describe("document form request errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps an invoice draft and allows retry after a rejected save", async () => {
    mocks.createInvoice
      .mockRejectedValueOnce(new Error("private backend detail"))
      .mockResolvedValueOnce({ ok: true, invoiceId: "invoice-1" });
    const user = userEvent.setup();
    render(
      <InvoiceForm
        mode="create"
        customers={customers}
        workspacePaymentMethods={[]}
        defaultCurrency="AUD"
      />,
    );
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Create invoice" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/couldn.t confirm whether this invoice was saved/i);
    expect(error).toHaveTextContent(/before trying again/i);
    expect(error).not.toHaveTextContent("private backend detail");
    const checkInvoices = within(error).getByRole("link", {
      name: /check invoices.*opens in a new tab/i,
    });
    expect(checkInvoices).toHaveAttribute("href", "/invoices");
    expect(checkInvoices).toHaveAttribute("target", "_blank");
    expect(screen.getByLabelText("Line 1 description")).toHaveValue("Consulting");
    expect(screen.getByLabelText("Line 1 unit price")).toHaveValue(125);

    await user.click(await screen.findByRole("button", { name: "Create invoice" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/invoices"));
    expect(mocks.createInvoice).toHaveBeenCalledTimes(2);
  });

  it("keeps a quote draft and allows retry after a rejected save", async () => {
    mocks.createQuote
      .mockRejectedValueOnce(new Error("private backend detail"))
      .mockResolvedValueOnce({ ok: true, quoteId: "quote-1" });
    const user = userEvent.setup();
    render(<QuoteForm mode="create" customers={customers} defaultCurrency="AUD" />);
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Create quote" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/couldn.t confirm whether this quote was saved/i);
    expect(error).toHaveTextContent(/before trying again/i);
    expect(error).not.toHaveTextContent("private backend detail");
    const checkQuotes = within(error).getByRole("link", {
      name: /check quotes.*opens in a new tab/i,
    });
    expect(checkQuotes).toHaveAttribute("href", "/quotes");
    expect(checkQuotes).toHaveAttribute("target", "_blank");
    expect(screen.getByLabelText("Line 1 description")).toHaveValue("Consulting");
    expect(screen.getByLabelText("Line 1 unit price")).toHaveValue(125);

    await user.click(await screen.findByRole("button", { name: "Create quote" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/quotes"));
    expect(mocks.createQuote).toHaveBeenCalledTimes(2);
  });

  it("locks invoice fields and Cancel while a save is pending", async () => {
    let resolveSave!: (result: { ok: true; invoiceId: string }) => void;
    mocks.createInvoice.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    render(
      <InvoiceForm
        mode="create"
        customers={customers}
        workspacePaymentMethods={[]}
        defaultCurrency="AUD"
      />,
    );
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(screen.getByLabelText("Customer")).toBeDisabled();
    expect(screen.getByLabelText("Line 1 description")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => resolveSave({ ok: true, invoiceId: "invoice-1" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/invoices"));
  });

  it("locks quote fields and Cancel while a save is pending", async () => {
    let resolveSave!: (result: { ok: true; quoteId: string }) => void;
    mocks.createQuote.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<QuoteForm mode="create" customers={customers} defaultCurrency="AUD" />);
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Create quote" }));

    expect(screen.getByLabelText("Customer")).toBeDisabled();
    expect(screen.getByLabelText("Line 1 description")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => resolveSave({ ok: true, quoteId: "quote-1" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/quotes"));
  });
});
