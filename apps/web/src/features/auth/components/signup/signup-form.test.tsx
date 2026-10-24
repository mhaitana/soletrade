import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "@/features/auth/components/signup/signup-form";

const { push, signUpAction, signInWithOtpAction } = vi.hoisted(() => ({
  push: vi.fn(),
  signUpAction: vi.fn(),
  signInWithOtpAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/features/auth/api/actions", () => ({
  signUpAction: (...args: unknown[]) => signUpAction(...args),
  signInWithOtpAction: (...args: unknown[]) => signInWithOtpAction(...args),
}));

function renderSignup() {
  return render(<SignupForm intent={{ moduleKeys: ["books"], interval: "monthly" }} />);
}

async function fillPasswordAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full name"), "Jane Smith");
  await user.type(screen.getByLabelText("Work email"), "jane@example.com");
  await user.type(screen.getByLabelText("Password", { selector: "input" }), "password123");
  await user.type(screen.getByLabelText("Confirm password", { selector: "input" }), "password123");
}

describe("SignupForm mobile stages", () => {
  beforeEach(() => {
    push.mockReset();
    signUpAction.mockReset();
    signInWithOtpAction.mockReset();
  });

  it("advances from Account to Tools & price after valid account input", async () => {
    const user = userEvent.setup();
    renderSignup();

    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Account");
    await fillPasswordAccount(user);
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));

    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Tools & price");
    expect(screen.getByRole("button", { name: "Back to account" })).toBeInTheDocument();
  });

  it("keeps users on Account when passwords differ", async () => {
    const user = userEvent.setup();
    renderSignup();
    await user.type(screen.getByLabelText("Work email"), "jane@example.com");
    await user.type(screen.getByLabelText("Password", { selector: "input" }), "password123");
    await user.type(
      screen.getByLabelText("Confirm password", { selector: "input" }),
      "different123",
    );
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Account");
  });

  it("keeps account and module choices when moving between stages", async () => {
    const user = userEvent.setup();
    renderSignup();
    await fillPasswordAccount(user);
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));
    await user.click(screen.getByRole("checkbox", { name: /Quotes/ }));
    await user.click(screen.getByRole("button", { name: /Annual/ }));
    await user.click(screen.getByRole("button", { name: "Back to account" }));

    expect(screen.getByLabelText("Work email")).toHaveValue("jane@example.com");
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));
    expect(screen.getByRole("checkbox", { name: /Quotes/ })).toBeChecked();
    expect(screen.getByRole("button", { name: /Annual/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("submits the preserved signup intent in magic-link mode", async () => {
    const user = userEvent.setup();
    signInWithOtpAction.mockResolvedValue({ ok: true, message: "Check your inbox." });
    render(
      <SignupForm
        intent={{ moduleKeys: ["books"], interval: "monthly", promotionCode: "SAVE25" }}
        promotion={{
          code: "SAVE25",
          label: "25% off once",
          discountType: "percentage",
          percentOff: 25,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Use a magic link" }));
    await user.type(screen.getByLabelText("Work email"), "jane@example.com");
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));
    await user.click(screen.getByRole("checkbox", { name: /Quotes/ }));
    await user.click(screen.getByRole("button", { name: /Annual/ }));
    await user.click(screen.getByRole("button", { name: "Email my sign-up link" }));

    expect(signInWithOtpAction).toHaveBeenCalledWith({
      email: "jane@example.com",
      mode: "signup",
      moduleKeys: ["books", "quotes"],
      interval: "annual",
      promotionCode: "SAVE25",
    });
  });

  it("returns to Account when signup returns an account error", async () => {
    const user = userEvent.setup();
    signUpAction.mockResolvedValue({ ok: false, error: "Email already registered." });
    renderSignup();
    await fillPasswordAccount(user);
    await user.click(screen.getByRole("button", { name: "Choose your tools" }));
    await user.click(screen.getByRole("button", { name: "Create account & continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email already registered.");
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Account");
  });

  it("uses narrow-screen-safe module and billing classes", () => {
    renderSignup();

    expect(screen.getByTestId("signup-stage-grid")).toHaveClass("min-w-0");
    expect(screen.getByText("Track income, expenses, and receipts.")).not.toHaveClass("truncate");
    expect(screen.getByRole("button", { name: "Monthly" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: /Annual/ })).toHaveClass("min-h-11");
  });
});
