import { describe, it, expect } from "vitest";
import manifest from "@/app/manifest";
import { brand } from "@/config/brand";

/**
 * The PWA manifest is generated from central brand config, so the product name lives in
 * one place. Pinning the shape here catches drift if someone hard-codes a name instead of
 * reading from `brand`.
 */
describe("web app manifest", () => {
  const m = manifest();

  it("uses the full product name", () => {
    expect(m.name).toBe(brand.productName);
    expect(m.name).toBe("Soletrade Workspace");
  });

  it("uses the short in-app label as the home-screen short name", () => {
    expect(m.short_name).toBe(brand.shortProductName);
    expect(m.short_name).toBe("Workspace");
  });

  it("uses the tagline as the description", () => {
    expect(m.description).toBe(brand.tagline);
  });

  it("declares standalone display", () => {
    expect(m.display).toBe("standalone");
  });

  it("does not surface the deprecated product name", () => {
    const json = JSON.stringify(m).toLowerCase();
    expect(json).not.toContain("soletrade os");
    expect(json).not.toContain("soletradeos");
  });
});
