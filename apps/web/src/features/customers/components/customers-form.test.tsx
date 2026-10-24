import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomerAction } from "@/features/customers/api/actions";
import { CustomerForm } from "@/features/customers/components/customers-form";
import { createHaiFormDirective, haiOpenFormInputSchema } from "@/lib/assisted-form/hai-workflows";
import { storeHaiFormDirective } from "@/components/assisted-form/hai-form-prefill";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("@/features/customers/api/actions", () => ({
  createCustomerAction: vi.fn(),
  updateCustomerAction: vi.fn(),
}));

describe("CustomerForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createCustomerAction).mockReset();
    window.sessionStorage.clear();
  });

  it("shows and associates server validation errors for phone and company", async () => {
    vi.mocked(createCustomerAction).mockResolvedValue({
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: {
        phone: ["Phone is too long."],
        company: ["Company is too long."],
      },
    });
    const user = userEvent.setup();
    render(<CustomerForm mode="create" />);
    await user.type(screen.getByLabelText("Name"), "Aster Labs");
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "1".repeat(121) } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "C".repeat(121) } });

    await user.click(screen.getByRole("button", { name: "Add customer" }));

    expect(await screen.findByText("Phone is too long.")).toBeInTheDocument();
    expect(screen.getByText("Company is too long.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-describedby", "phone-error");
    expect(screen.getByLabelText("Company")).toHaveAttribute("aria-describedby", "company-error");
    expect(screen.getByLabelText("Phone")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Company")).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText("Name")).toHaveValue("Aster Labs");
    expect(screen.getByLabelText("Phone")).toHaveValue("1".repeat(121));
    expect(screen.getByLabelText("Company")).toHaveValue("C".repeat(121));
  });

  it("keeps entered details and retries safely after a rejected request", async () => {
    vi.mocked(createCustomerAction)
      .mockRejectedValueOnce(new Error("private backend detail"))
      .mockResolvedValueOnce({ ok: true, customerId: "customer-1" });
    const user = userEvent.setup();
    render(<CustomerForm mode="create" />);
    await user.type(screen.getByLabelText("Name"), "Aster Labs");
    await user.type(screen.getByLabelText("Email"), "billing@aster.test");
    await user.type(screen.getByLabelText("Phone"), "+61 400 000 000");
    await user.type(screen.getByLabelText("Company"), "Aster Pty Ltd");
    await user.type(screen.getByLabelText("Notes"), "Prefers email");

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
    expect(screen.getByLabelText("Phone")).toHaveValue("+61 400 000 000");
    expect(screen.getByLabelText("Company")).toHaveValue("Aster Pty Ltd");
    expect(screen.getByLabelText("Notes")).toHaveValue("Prefers email");

    await user.click(await screen.findByRole("button", { name: "Add customer" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
    expect(createCustomerAction).toHaveBeenNthCalledWith(2, {
      name: "Aster Labs",
      email: "billing@aster.test",
      phone: "+61 400 000 000",
      company: "Aster Pty Ltd",
      notes: "Prefers email",
    });
  });

  it("locks the editable form and Cancel button while a save is pending", async () => {
    let resolveSave!: (result: { ok: true; customerId: string }) => void;
    vi.mocked(createCustomerAction).mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<CustomerForm mode="create" />);
    await user.type(screen.getByLabelText("Name"), "Aster Labs");
    await user.type(screen.getByLabelText("Notes"), "Keep this draft");

    await user.click(screen.getByRole("button", { name: "Add customer" }));

    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText("Notes")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => resolveSave({ ok: true, customerId: "customer-1" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/customers"));
  });

  it("keeps an hAI-prefilled draft after a returned error", async () => {
    storeHaiFormDirective(
      createHaiFormDirective(
        haiOpenFormInputSchema.parse({
          workflow: "customer.create",
          requestSummary: "Add Aster Labs as a customer",
          fields: {
            name: "Aster Labs",
            email: "billing@aster.test",
            phone: "+61 400 000 000",
            company: "Aster Pty Ltd",
            notes: "Prefers email",
          },
        }),
      ),
    );
    vi.mocked(createCustomerAction).mockResolvedValue({
      ok: false,
      error: "Please try again.",
    });
    const user = userEvent.setup();
    render(<CustomerForm mode="create" />);
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Aster Labs"));

    await user.click(screen.getByRole("button", { name: "Add customer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again.");
    expect(screen.getByLabelText("Name")).toHaveValue("Aster Labs");
    expect(screen.getByLabelText("Email")).toHaveValue("billing@aster.test");
    expect(screen.getByLabelText("Phone")).toHaveValue("+61 400 000 000");
    expect(screen.getByLabelText("Company")).toHaveValue("Aster Pty Ltd");
    expect(screen.getByLabelText("Notes")).toHaveValue("Prefers email");
  });
});
