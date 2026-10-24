import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "@/components/sparkline";

describe("shared <Sparkline>", () => {
  it("renders an svg with the accessible label + per-point tooltips", () => {
    const { container } = render(
      <Sparkline
        ariaLabel="Monthly net trend"
        points={[
          { month: "2026-05", value: 1000, label: "$10.00" },
          { month: "2026-06", value: -500, label: "-$5.00" },
          { month: "2026-07", value: 2000, label: "$20.00" },
        ]}
      />,
    );
    // The `<svg role="img">` exposes its aria-label as the accessible name.
    const svg = screen.getByRole("img", { name: "Monthly net trend" });
    expect(svg.tagName.toLowerCase()).toBe("svg");
    // Each point renders a `<circle>` whose child `<title>` text is `month: label`.
    const titles = Array.from(container.querySelectorAll("svg circle title")).map(
      (t) => t.textContent,
    );
    expect(titles).toEqual(["2026-05: $10.00", "2026-06: -$5.00", "2026-07: $20.00"]);
  });

  it("shows the date-range caption when there are 2+ points", () => {
    render(
      <Sparkline
        ariaLabel="Trend"
        points={[
          { month: "2026-05", value: 1, label: "a" },
          { month: "2026-07", value: 2, label: "b" },
        ]}
      />,
    );
    // The caption is `first – last`.
    expect(screen.getByText("2026-05 – 2026-07")).toBeTruthy();
  });

  it("renders the 'Insufficient data' caption for fewer than 2 points", () => {
    render(
      <Sparkline ariaLabel="Trend" points={[{ month: "2026-07", value: 0, label: "$0.00" }]} />,
    );
    expect(screen.getByText("Insufficient data for a trend.")).toBeTruthy();
  });

  it("renders the 'Insufficient data' caption when all values are zero", () => {
    render(
      <Sparkline
        ariaLabel="Trend"
        points={[
          { month: "2026-05", value: 0, label: "$0.00" },
          { month: "2026-06", value: 0, label: "$0.00" },
        ]}
      />,
    );
    expect(screen.getByText("Insufficient data for a trend.")).toBeTruthy();
  });

  it("renders a dashed zero baseline when the series crosses zero", () => {
    const { container } = render(
      <Sparkline
        ariaLabel="Trend"
        points={[
          { month: "2026-05", value: -100, label: "-$1.00" },
          { month: "2026-06", value: 100, label: "$1.00" },
        ]}
      />,
    );
    // The zero baseline is the only `<line>` in the svg.
    const line = container.querySelector("svg line");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("stroke-dasharray")).toBe("2 2");
  });

  it("does not render a zero baseline when all values are non-negative", () => {
    const { container } = render(
      <Sparkline
        ariaLabel="Trend"
        points={[
          { month: "2026-05", value: 100, label: "$1.00" },
          { month: "2026-06", value: 300, label: "$3.00" },
        ]}
      />,
    );
    expect(container.querySelector("svg line")).toBeNull();
  });

  it("renders without crashing on an empty points array", () => {
    render(<Sparkline ariaLabel="Trend" points={[]} />);
    // No date-range caption when there are no points, but the svg still renders.
    expect(screen.getByRole("img", { name: "Trend" })).toBeTruthy();
  });
});
