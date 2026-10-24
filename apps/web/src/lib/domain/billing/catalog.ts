import { priceSubscription } from "@/lib/domain/billing/pricing";
import type { MobileModule } from "@soletrade/contracts";

export interface StoreOffer {
  key: string;
  modules: MobileModule[];
  interval: "monthly" | "annual";
  targetPriceCents: number;
  appleProductId: string;
  googleProductId: string;
  googleBasePlanId: string;
}
export function generateStoreOffers(): StoreOffer[] {
  const modules: MobileModule[] = ["books", "drive", "invoices", "quotes"];
  const offers: StoreOffer[] = [];
  for (let mask = 1; mask < 16; mask++) {
    const selected = modules.filter((_, i) => Boolean(mask & (1 << i)));
    const bundle = selected.join("_");
    for (const interval of ["monthly", "annual"] as const)
      offers.push({
        key: `${bundle}_${interval}`,
        modules: selected,
        interval,
        targetPriceCents: Math.ceil(priceSubscription(selected, interval).totalCents * 1.2),
        appleProductId: `com.soletrade.business.${bundle}.${interval}`,
        googleProductId: `business_${bundle}`,
        googleBasePlanId: interval,
      });
  }
  return offers;
}
export function findStoreOffer(
  provider: "apple" | "google",
  productId: string,
  basePlanId?: string,
) {
  return generateStoreOffers().find((o) =>
    provider === "apple"
      ? o.appleProductId === productId
      : o.googleProductId === productId && o.googleBasePlanId === basePlanId,
  );
}
