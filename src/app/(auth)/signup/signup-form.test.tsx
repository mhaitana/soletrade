import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";

const { push, signUpAction, signInWithOtpAction } = vi.hoisted(() => ({
  push: vi.fn(),
  signUpAction: vi.fn(),
  signInWithOtpAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/app/(auth)/actions", () => ({
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
});
