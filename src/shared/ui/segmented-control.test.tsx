import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentedControl } from "./segmented-control";

describe("shared <SegmentedControl>", () => {
  it("renders a labelled group of links and marks the active item", () => {
    render(
      <SegmentedControl
        label="Dashboard period"
        items={[
          { key: "week", label: "Week", href: "/dashboard?period=week" },
          {
            key: "month",
            label: "Month",
            href: "/dashboard?period=month",
            active: true,
          },
          { key: "year", label: "Year", href: "/dashboard?period=year" },
        ]}
      />,
    );

    const group = screen.getByRole("group", { name: "Dashboard period" });
    expect(group).toBeTruthy();

    const month = screen.getByText("Month").closest("a");
    expect(month?.getAttribute("href")).toBe("/dashboard?period=month");
    expect(month?.getAttribute("aria-current")).toBe("page");

    // Inactive items do not carry aria-current.
    const week = screen.getByText("Week").closest("a");
    expect(week?.getAttribute("aria-current")).toBeNull();
  });
});