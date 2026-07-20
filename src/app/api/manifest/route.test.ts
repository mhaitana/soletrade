import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/manifest/route";
import { brand } from "@/config/brand";

/**
 * The PWA manifest endpoint must return a valid Web App Manifest with the brand
 * names and icon set wired up correctly.
 */
describe("GET /api/manifest", () => {
  it("returns a manifest with the product and short name", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/manifest+json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.name).toBe(brand.productName);
    expect(body.short_name).toBe(brand.shortProductName);
  });

  it("includes all required icon sizes plus a maskable icon", async () => {
    const response = await GET();
    const body = (await response.json()) as { icons?: Array<{ sizes?: string; purpose?: string }> };
    const sizes = body.icons?.map((icon) => icon.sizes).sort();

    expect(sizes).toEqual(["192x192", "512x512", "512x512"]);
    expect(body.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("declares standalone display and business categories", async () => {
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.display).toBe("standalone");
    expect(body.categories).toContain("business");
    expect(body.prefer_related_applications).toBe(false);
  });
});
