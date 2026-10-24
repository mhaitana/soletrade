import { describe, it, expect } from "vitest";
import { brand } from "@/config/brand";

/**
 * Brand config is the single source of truth for customer-facing brand strings.
 * These values feed metadata, the manifest, the Logo, email templates, PDFs, and the
 * Stripe statement descriptor - pinning them here catches accidental drift in any of those.
 */
describe("brand config", () => {
  it("exposes the public product name", () => {
    expect(brand.productName).toBe("Soletrade");
  });

  it("retains the parent wordmark for existing email/PDF headers", () => {
    expect(brand.wordmark).toBe("soletrade");
  });

  it("exposes the short in-app product label", () => {
    expect(brand.shortProductName).toBe("Business");
  });

  it("exposes the company name (distinct from the product)", () => {
    expect(brand.companyName).toBe("Matt Haitana");
    // Product ≠ company - the product/tenant distinction must be preserved.
    expect(brand.productName).not.toBe(brand.companyName);
  });

  it("keeps the repo/package slug as a stable technical identifier", () => {
    expect(brand.repositoryName).toBe("soletrade");
  });

  it("uses the agreed tagline", () => {
    expect(brand.tagline).toBe("One workspace to run your business.");
  });

  it("carries the unchanged Stripe statement descriptors", () => {
    expect(brand.stripeStatementDescriptor).toBe("SOLETRADELABS");
    expect(brand.stripeShortenedDescriptor).toBe("SOLETRADE");
  });

  it("never reintroduces the deprecated product name", () => {
    const json = JSON.stringify(brand).toLowerCase();
    expect(json).not.toContain("soletrade os");
    expect(json).not.toContain("soletradeos");
    expect(json).not.toContain("soletrade workspace");
    // "soletrade suite" (the deprecated product form) must not appear - only the
    // hyphenated repo slug `soletrade` is valid, and that has no space.
    expect(json).not.toContain("soletrade suite");
  });

  it("does not rename the workspace tenant model", () => {
    // The `workspace` tenant concept is separate from the product name. The brand config
    // must not surface a renamed tenant identifier like `soletradeWorkspace`.
    const json = JSON.stringify(brand);
    expect(json).not.toContain("soletradeWorkspace");
    expect(json).not.toContain("SoletradeWorkspace");
  });
});
