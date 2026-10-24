import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomerAction, type CreateCustomerResult } from "./actions";
import { CustomerCreateDialog } from "./customer-create-dialog";

vi.mock("@/shared/lib/use-media-query", () => ({ useIsMobile: () => false }));
vi.mock("./actions", () => ({ createCustomerAction: vi.fn() }));

async function openAndFill() {
  const user = userEvent.setup();
  const onCreated = vi.fn();
  render(<CustomerCreateDialog onCreated={onCreated} />);
  await user.click(screen.getByRole("button", { name: "Add customer" }));
  await user.type(screen.getByLabelText("Name"), "Aster Labs");
  await user.type(screen.getByLabelText("Email"), "billing@aster.test");
  return { onCreated, user };
}

describe("CustomerCreateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps entered customer details open until the save finishes", async () => {
    let resolveSave!: (result: CreateCustomerResult) => void;
    vi.mocked(createCustomerAction).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { onCreated, user } = await openAndFill();

    await user.click(screen.getByRole("button", { name: "Add customer" }));

    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Aster Labs");
    expect(screen.getByLabelText("Email")).toHaveValue("billing@aster.test");

    await act(async () => resolveSave({ ok: true, customerId: "customer-1" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onCreated).toHaveBeenCalledWith({
      id: "customer-1",
      name: "Aster Labs",
      email: "billing@aster.test",
      company: null,
    });
  });

  it("shows a safe error, retains entered details, and allows retry after a rejected save", async () => {
    vi.mocked(createCustomerAction)
      .mockRejectedValueOnce(new Error("private backend detail"))
      .mockResolvedValueOnce({ ok: true, customerId: "customer-2" });
    const { onCreated, user } = await openAndFill();

    await user.click(screen.getByRole("button", { name: "Add customer" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/couldn.t confirm whether this customer was saved/i);
    expect(error).toHaveTextContent(/before trying again/i);
    expect(error).not.toHaveTextContent("private backend detail");
    const checkCustomers = within(error).getByRole("link", {
      name: /check customers.*opens in a new tab/i,
    });
    expect(checkCustomers).toHaveAttribute("href", "/customers");
    expect(checkCustomers).toHaveAttribute("target", "_blank");
    expect(screen.getByLabelText("Name")).toHaveValue("Aster Labs");
    expect(screen.getByLabelText("Email")).toHaveValue("billing@aster.test");

    await user.click(await screen.findByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createCustomerAction).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
