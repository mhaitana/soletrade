import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuthLayout from "@/application/layouts/auth-layout";

describe("auth parent branding", () => {
  it("keeps Matt Haitana visible as the company behind the account screens", () => {
    render(
      <AuthLayout>
        <p>Account form</p>
      </AuthLayout>,
    );

    expect(screen.getByText(/© \d{4} Matt Haitana/)).toBeVisible();
    expect(screen.getByText("Account form")).toBeVisible();
  });
});
