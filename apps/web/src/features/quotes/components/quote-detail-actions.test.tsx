import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuoteDetailActions } from "@/features/quotes/components/quote-detail-actions";
import * as actions from "@/features/quotes/api/actions";
import { toast } from "sonner";

const sendQuoteActionMock = vi.fn();
const deleteQuoteActionMock = vi.fn();
const convertQuoteToInvoiceActionMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/features/quotes/api/actions", async (importOriginal) => {
  const mod = await importOriginal<typeof actions>();
  return {
    ...mod,
    sendQuoteAction: (...args: Parameters<typeof actions.sendQuoteAction>) =>
      sendQuoteActionMock(...args),
    deleteQuoteAction: (...args: Parameters<typeof actions.deleteQuoteAction>) =>
      deleteQuoteActionMock(...args),
    convertQuoteToInvoiceAction: (
      ...args: Parameters<typeof actions.convertQuoteToInvoiceAction>
    ) => convertQuoteToInvoiceActionMock(...args),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
}));

const QUOTE_ID = "00000000-0000-0000-0000-000000000002";

describe("QuoteDetailActions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("closes the confirmation and toasts once the quote is sent", async () => {
    sendQuoteActionMock.mockResolvedValue({ ok: true });
    render(<QuoteDetailActions quoteId={QUOTE_ID} status="draft" />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sendQuoteActionMock).toHaveBeenCalledWith({ quoteId: QUOTE_ID });
    expect(toast.success).toHaveBeenCalledWith("Quote sent.");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("keeps the confirmation open and shows the error inside it when sending fails", async () => {
    sendQuoteActionMock.mockResolvedValue({ ok: false, error: "Customer has no email." });
    render(<QuoteDetailActions quoteId={QUOTE_ID} status="draft" />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Customer has no email.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("clears a previous error when the confirmation is reopened", async () => {
    sendQuoteActionMock.mockResolvedValue({ ok: false, error: "Customer has no email." });
    render(<QuoteDetailActions quoteId={QUOTE_ID} status="draft" />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  });

  it("opens the new draft invoice after converting an accepted quote", async () => {
    convertQuoteToInvoiceActionMock.mockResolvedValue({ ok: true, invoiceId: "inv-9" });
    render(<QuoteDetailActions quoteId={QUOTE_ID} status="accepted" />);

    await userEvent.click(screen.getByRole("button", { name: /convert to invoice/i }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Convert to invoice" }),
    );

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/invoices/inv-9"));
    expect(toast.success).toHaveBeenCalledWith("Draft invoice created from this quote.");
  });
});
