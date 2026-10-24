import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateWorkspaceForm } from "@/application/onboarding/create-workspace-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/features/workspaces/api/workspaces", () => ({
  createWorkspaceAction: vi.fn(),
}));

vi.mock("@/features/billing/api/actions", () => ({
  startBillingCheckoutAction: vi.fn(),
}));

describe("CreateWorkspaceForm", () => {
  it("keeps the selected setup visible without opening the mobile keyboard", () => {
    render(
      <CreateWorkspaceForm
        intent={{
          moduleKeys: ["books", "quotes"],
          interval: "annual",
          promotionCode: "SAVE25",
        }}
        promotionLabel="25% off once"
      />,
    );

    expect(screen.getByLabelText("Workspace name")).not.toHaveFocus();
    expect(screen.getByText("Your selected setup")).toBeInTheDocument();
    expect(screen.getByText(/25% off once will be applied automatically/)).toBeInTheDocument();
  });
});
