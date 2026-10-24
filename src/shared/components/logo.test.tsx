import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Logo } from "@/shared/components/logo";
import { brand } from "@/config/brand";
import { pwaBrand } from "@/config/pwa";

/**
 * Product lockups share the installed app's HB artwork. Full labels name the product,
 * compact labels fit the app shell, and mark-only links remain accessible.
 */
describe("Logo", () => {
  it("renders the product name in the `full` variant", () => {
    const { getByText, queryByText } = render(<Logo variant="full" href={null} />);
    expect(getByText("Soletrade")).toBeTruthy();
    expect(queryByText("soletrade")).toBeNull();
  });

  it("uses the installed app's HB artwork with reserved image dimensions", () => {
    const { container } = render(<Logo variant="full" href={null} />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("src", pwaBrand.icons.standard192);
    expect(image).toHaveAttribute("width", "32");
    expect(image).toHaveAttribute("height", "32");
    expect(image).toHaveAttribute("alt", "");
  });

  it("renders the short product label in the `compact` variant", () => {
    const { getByText } = render(<Logo variant="compact" href={null} />);
    expect(getByText(brand.shortProductName)).toBeTruthy();
  });

  it("gives a mark-only link an accessible product name", () => {
    const { getByRole, queryByText } = render(<Logo variant="mark" href="/dashboard" />);
    expect(getByRole("link", { name: "Soletrade" })).toHaveAttribute("href", "/dashboard");
    expect(queryByText(brand.productName)).toBeNull();
    expect(queryByText(brand.shortProductName)).toBeNull();
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
