import { describe, it, expect } from "vitest";
import { getManifest } from "@/config/manifest";
import { brand } from "@/config/brand";

/**
 * The PWA manifest is generated from central brand config, so the product name lives in
 * one place. Pinning the shape here catches drift if someone hard-codes a name instead of
 * reading from `brand`.
 */
describe("web app manifest", () => {
  const m = getManifest();

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

  it("has a root scope and english language", () => {
    expect(m.scope).toBe("/");
    expect(m.lang).toBe("en");
    expect(m.dir).toBe("ltr");
  });

  it("uses light-mode brand colors so splash screens match public pages", () => {
    expect(m.background_color).toBe("#f8fafc");
    expect(m.theme_color).toBe("#f8fafc");
  });

  it("declares business categories and no native related applications", () => {
    expect(m.categories).toContain("business");
    expect(m.prefer_related_applications).toBe(false);
  });

  it("includes all required icon sizes", () => {
    const sizes = m.icons?.map((icon) => icon.sizes).sort() ?? [];
    expect(sizes).toEqual(["192x192", "512x512", "512x512"]);

    const maskable = m.icons?.find((icon) => icon.purpose === "maskable");
    expect(maskable).toBeDefined();
    expect(maskable?.src).toBe("/icons/icon-512x512-maskable.png");
  });

  it("includes shortcuts for the primary merchant workflows", () => {
    const names = m.shortcuts?.map((shortcut) => shortcut.name);
    expect(names).toEqual(["Dashboard", "New invoice", "New quote", "Books"]);
  });

  it("does not surface the deprecated product name", () => {
    const json = JSON.stringify(m).toLowerCase();
    expect(json).not.toContain("soletrade os");
    expect(json).not.toContain("soletradeos");
  });
});
