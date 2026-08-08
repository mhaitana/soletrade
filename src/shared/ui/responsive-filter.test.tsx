import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { ResponsiveFilter } from "./responsive-filter";

describe("shared <ResponsiveFilter>", () => {
  it("exposes the active option in the mobile trigger and desktop group", () => {
    render(
      <ResponsiveFilter
        label="Filter invoices by status"
        items={[
          { key: "all", label: "All", href: "/invoices", active: true },
          { key: "paid", label: "Paid", href: "/invoices?status=paid" },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Filter invoices by status: All" }),
    ).toBeTruthy();
    const desktopGroup = screen.getByRole("group", {
      name: "Filter invoices by status",
    });
    expect(desktopGroup).toBeTruthy();
    expect(
      within(desktopGroup).getByText("All").closest("a")?.getAttribute("aria-current"),
    ).toBe("page");
  });
});
