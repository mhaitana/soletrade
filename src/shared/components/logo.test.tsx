import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Logo } from "@/shared/components/logo";
import { brand } from "@/config/brand";

/**
 * The Logo lockup is context-aware: `full` shows the `soletrade` wordmark on external
 * surfaces, `compact` shows the short `Business` label in-app, and `mark` shows only the `h`
 * on public invoice/quote pages where the issuing merchant is the dominant brand. The prose
 * product name (`Soletrade`) is never rendered by the Logo.
 */
describe("Logo", () => {
  it("renders the wordmark in the `full` variant", () => {
    const { getByText } = render(<Logo variant="full" href={null} />);
    expect(getByText(brand.wordmark)).toBeTruthy();
    expect(getByText("soletrade")).toBeTruthy();
  });

  it("renders the short product label in the `compact` variant", () => {
    const { getByText } = render(<Logo variant="compact" href={null} />);
    expect(getByText(brand.shortProductName)).toBeTruthy();
  });

  it("renders only the `h` mark in the `mark` variant (no wordmark)", () => {
    const { queryByText, container } = render(<Logo variant="mark" href={null} />);
    expect(queryByText(brand.wordmark)).toBeNull();
    expect(queryByText(brand.shortProductName)).toBeNull();
    // No wordmark - just the mark.
    expect(container.textContent).toContain("h");
  });

  it("defaults to the `full` variant", () => {
    const { getByText } = render(<Logo href={null} />);
    expect(getByText(brand.wordmark)).toBeTruthy();
  });

  it("wraps the lockup in a link when href is provided", () => {
    const { container } = render(<Logo href="/dashboard" />);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/dashboard");
  });

  it("does not wrap in a link when href is null", () => {
    const { container } = render(<Logo href={null} />);
    expect(container.querySelector("a")).toBeNull();
  });
});
