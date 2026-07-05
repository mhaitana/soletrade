import type { ModuleKey } from "@/shared/constants/modules";
import type { PlanTier } from "@/server/db/schema/enums";

/**
 * Pricing engine (brief §4 — anchor app + add-on stack discount). Pure: no
 * `server-only`, no DB, no I/O — safe to unit-test and to import from client
 * components (the public /pricing page does exactly that). All money is integer
 * cents to avoid floating-point drift; the catalog is the single source of
 * truth for prices and is trivially editable.
 *
 *   Free tier  — $0 anchor, no paid modules (the freemium gate).
 *   Pro tier   — $29/mo anchor + $15/mo per module, with a stack discount on
 *                add-ons: 1st module full price, 2nd 10% off, 3rd 15% off, 4th+ 20% off.
 *
 * The engine is pure arithmetic — it does not decide policy. Tier policy (whether
 * a tier may add modules at all) lives in `canAddModuleOnTier` so the
 * subscription service can gate enablement without re-deriving prices.
 */
export const PRICING_CATALOG = {
  currency: "AUD",
  tiers: {
    free: {
      label: "Free",
      anchorCents: 0,
      modulePriceCents: 0,
      allowsModules: false,
    },
    pro: {
      label: "Pro",
      anchorCents: 2900,
      modulePriceCents: 1500,
      allowsModules: true,
    },
  },
  /**
   * Stack discount on add-on modules (Pro only). Index = (module position - 1).
   * The first module is full price; subsequent modules get a deeper discount,
   * rewarding the add-on stack. The last rate applies to every module beyond
   * the list length.
   */
  stackDiscountRates: [0, 0.1, 0.15, 0.2],
  /** How many modules a Free workspace may enable (0 = none; upgrade required). */
  freeTierModuleLimit: 0,
} as const satisfies PricingCatalogShape;

export interface TierConfig {
  label: string;
  anchorCents: number;
  modulePriceCents: number;
  allowsModules: boolean;
}

export interface PricingCatalogShape {
  currency: string;
  tiers: Record<PlanTier, TierConfig>;
  stackDiscountRates: readonly number[];
  freeTierModuleLimit: number;
}

export interface ModulePriceBreakdown {
  key: ModuleKey;
  grossCents: number;
  discountCents: number;
  netCents: number;
}

export interface PricingBreakdown {
  tier: PlanTier;
  currency: string;
  anchorCents: number;
  modules: ModulePriceBreakdown[];
  totalDiscountCents: number;
  totalCents: number;
}

/**
 * Discount rate applied to the (position+1)th module. The last configured rate
 * applies to every module beyond the list. 0% for the first module.
 */
export function stackDiscountRate(position: number): number {
  if (position <= 0) return 0;
  const rates = PRICING_CATALOG.stackDiscountRates;
  // position is 0-indexed; clamp to the last configured rate.
  return rates[Math.min(position, rates.length - 1)] ?? rates[rates.length - 1]!;
}

/** The rate that would apply to the NEXT module if a workspace adds one. */
export function nextModuleDiscountRate(currentModuleCount: number): number {
  return stackDiscountRate(currentModuleCount);
}

/** May a workspace on this tier add (paid) modules? Free → false. */
export function canAddModuleOnTier(tier: PlanTier): boolean {
  return PRICING_CATALOG.tiers[tier].allowsModules;
}

/** The per-month price of a subscription on `tier` with the given modules. */
export function priceSubscription(tier: PlanTier, moduleKeys: ModuleKey[]): PricingBreakdown {
  const tierConfig = PRICING_CATALOG.tiers[tier];
  const modules: ModulePriceBreakdown[] = moduleKeys.map((key, index) => {
    const gross = tierConfig.modulePriceCents;
    const rate = stackDiscountRate(index);
    // Round to whole cents. Module prices are whole-dollar ($15) so the result
    // is exact; the rounding keeps fractional-rate tiers correct if added later.
    const discountCents = Math.round(gross * rate);
    return { key, grossCents: gross, discountCents, netCents: gross - discountCents };
  });
  const anchorCents = tierConfig.anchorCents;
  const totalDiscountCents = modules.reduce((sum, m) => sum + m.discountCents, 0);
  const totalCents = anchorCents + modules.reduce((sum, m) => sum + m.netCents, 0);
  return {
    tier,
    currency: PRICING_CATALOG.currency,
    anchorCents,
    modules,
    totalDiscountCents,
    totalCents,
  };
}

/** Format cents as a human-readable currency string for UI display. */
export function formatCents(cents: number, currency: string = PRICING_CATALOG.currency): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${sign}${currency === "AUD" ? "$" : ""}${whole}.${fraction.toString().padStart(2, "0")}`;
}
