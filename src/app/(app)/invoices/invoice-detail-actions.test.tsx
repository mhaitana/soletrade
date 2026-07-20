import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InvoiceDetailActions } from "./invoice-detail-actions";
import * as actions from "./actions";
import { toast } from "sonner";

const sendInvoiceActionMock = vi.fn();
const markInvoicePaidActionMock = vi.fn();
const voidInvoiceActionMock = vi.fn();
const deleteInvoiceActionMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock("./actions", async (importOriginal) => {
  const mod = await importOriginal<typeof actions>();
  return {
    ...mod,
    sendInvoiceAction: (...args: Parameters<typeof actions.sendInvoiceAction>) =>
      sendInvoiceActionMock(...args),
    markInvoicePaidAction: (...args: Parameters<typeof actions.markInvoicePaidAction>) =>
      markInvoicePaidActionMock(...args),
    voidInvoiceAction: (...args: Parameters<typeof actions.voidInvoiceAction>) =>
      voidInvoiceActionMock(...args),
    deleteInvoiceAction: (...args: Parameters<typeof actions.deleteInvoiceAction>) =>
      deleteInvoiceActionMock(...args),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
}));

describe("InvoiceDetailActions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the send dialog and describes that an email is sent", async () => {
    sendInvoiceActionMock.mockResolvedValue({ ok: true });
    render(<InvoiceDetailActions invoiceId="00000000-0000-0000-0000-000000000001" status="draft" />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(/creates a public payment link, and emails the customer a payable link/i),
    ).toBeTruthy();
  });

  it("closes the dialog and toasts on successful send", async () => {
    sendInvoiceActionMock.mockResolvedValue({ ok: true });
    render(<InvoiceDetailActions invoiceId="00000000-0000-0000-0000-000000000001" status="draft" />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendInvoiceActionMock).toHaveBeenCalledWith({
        invoiceId: "00000000-0000-0000-0000-000000000001",
      });
    });

    expect(toast.success).toHaveBeenCalledWith("Invoice sent.");
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the dialog open and shows the error when send fails", async () => {
    sendInvoiceActionMock.mockResolvedValue({ ok: false, error: "Not authorized." });
    render(<InvoiceDetailActions invoiceId="00000000-0000-0000-0000-000000000001" status="draft" />);

    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(sendInvoiceActionMock).toHaveBeenCalled();
    });

    // Radix Dialog hides background nodes with aria-hidden when open, so query the
    // error text inside the dialog's accessible tree.
    expect(screen.getByText("Not authorized.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
