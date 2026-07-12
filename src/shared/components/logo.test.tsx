import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Logo } from "@/shared/components/logo";
import { brand } from "@/config/brand";

/**
 * The Logo lockup is context-aware: `full` shows the product name on external surfaces,
 * `compact` shows the short label in-app, and `mark` shows only the `h` on public invoice/quote
 * pages where the issuing merchant is the dominant brand. The wordmark is always rendered
 * lowercase (CSS class) to match the existing wordmark theme - the source strings stay title-case.
 */
describe("Logo", () => {
  it("renders the full product name in the `full` variant", () => {
    const { getByText, container } = render(<Logo variant="full" href={null} />);
    expect(getByText(brand.productName)).toBeTruthy();
    // The wordmark span carries the lowercase visual treatment.
    const wordmark = container.querySelector(".lowercase");
    expect(wordmark?.textContent).toBe(brand.productName);
  });

  it("renders the short product label in the `compact` variant", () => {
    const { getByText, container } = render(<Logo variant="compact" href={null} />);
    expect(getByText(brand.shortProductName)).toBeTruthy();
    const wordmark = container.querySelector(".lowercase");
    expect(wordmark?.textContent).toBe(brand.shortProductName);
  });

  it("renders only the `h` mark in the `mark` variant (no wordmark)", () => {
    const { queryByText, container } = render(<Logo variant="mark" href={null} />);
    expect(queryByText(brand.productName)).toBeNull();
    expect(queryByText(brand.shortProductName)).toBeNull();
    // No lowercase wordmark span - just the mark.
    expect(container.querySelector(".lowercase")).toBeNull();
    // The mark itself still renders.
    expect(container.textContent).toContain("h");
  });

  it("defaults to the `full` variant", () => {
    const { getByText } = render(<Logo href={null} />);
    expect(getByText(brand.productName)).toBeTruthy();
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
