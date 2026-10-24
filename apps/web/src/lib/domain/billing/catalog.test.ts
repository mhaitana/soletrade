import { describe, expect, it } from "vitest";
import { generateStoreOffers, findStoreOffer } from "@/lib/domain/billing/catalog";
describe("store module catalogue", () => {
  it("offers every nonempty combination for both billing periods without duplicate store products", () => {
    const offers = generateStoreOffers();
    expect(offers).toHaveLength(30);
    expect(new Set(offers.map((o) => o.appleProductId)).size).toBe(30);
    expect(new Set(offers.map((o) => o.googleProductId)).size).toBe(15);
    expect(offers.every((o) => o.modules.length > 0 && o.modules.length <= 4)).toBe(true);
  });
  it("targets a 20 percent uplift on existing all-module monthly and annual pricing", () => {
    const all = generateStoreOffers().filter((o) => o.modules.length === 4);
    expect(all.find((o) => o.interval === "monthly")?.targetPriceCents).toBe(2700);
    expect(all.find((o) => o.interval === "annual")?.targetPriceCents).toBe(24300);
  });
  it("rejects invented product IDs and requires a matching Google base plan", () => {
    expect(findStoreOffer("google", "business_invoices", "annual")?.interval).toBe("annual");
    expect(findStoreOffer("google", "business_invoices", "other")).toBeUndefined();
    expect(findStoreOffer("apple", "free_unlimited")).toBeUndefined();
  });
});
