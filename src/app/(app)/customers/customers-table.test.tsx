import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerRow } from "@/platform/customers";
import { branded } from "@/shared/types/ids";
import { deleteCustomerAction, type DeleteCustomerResult } from "./actions";
import { CustomersTable } from "./customers-table";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("./actions", () => ({ deleteCustomerAction: vi.fn() }));

const customer: CustomerRow = {
  id: branded<"CustomerId">("00000000-0000-0000-0000-000000000001"),
  workspaceId: branded<"WorkspaceId">("00000000-0000-0000-0000-000000000002"),
  name: "Alex Green",
  email: "alex@example.com",
  phone: null,
  company: null,
  notes: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

async function openDeleteDialog() {
  const user = userEvent.setup();
  render(<CustomersTable customers={[customer]} canManage />);
  await user.click(screen.getByRole("button", { name: "Delete Alex Green" }));
  return user;
}

describe("CustomersTable deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteCustomerAction).mockReset();
  });

  it("keeps a failed deletion visible with an accessible error and allows retry", async () => {
    vi.mocked(deleteCustomerAction)
      .mockResolvedValueOnce({ ok: false, error: "You don't have permission to manage customers." })
      .mockResolvedValueOnce({ ok: true });
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to manage customers.",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Alex Green");
    expect(refresh).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteCustomerAction).toHaveBeenNthCalledWith(2, { customerId: customer.id });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending dialog open and prevents duplicate requests or dismissal", async () => {
    let resolveDelete!: (result: DeleteCustomerResult) => void;
    vi.mocked(deleteCustomerAction).mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deleteCustomerAction).toHaveBeenCalledTimes(1);
    expect(deleteCustomerAction).toHaveBeenCalledWith({ customerId: customer.id });
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => resolveDelete({ ok: true }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("recovers from a thrown request error without losing the customer selection", async () => {
    vi.mocked(deleteCustomerAction)
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true });
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    expect(screen.getByRole("dialog")).toHaveTextContent("Alex Green");
    expect(await screen.findByRole("button", { name: "Delete" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteCustomerAction).toHaveBeenNthCalledWith(2, { customerId: customer.id });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears a previous error when the user cancels and opens a new confirmation", async () => {
    vi.mocked(deleteCustomerAction).mockResolvedValue({ ok: false, error: "Please try again." });
    const user = await openDeleteDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Delete Alex Green" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});
