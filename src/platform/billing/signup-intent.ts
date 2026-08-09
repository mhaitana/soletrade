import { MODULE_KEYS, isModuleKey, type ModuleKey } from "@/shared/constants/modules";
import type { Interval } from "./pricing";

export const DEFAULT_SIGNUP_MODULES: readonly ModuleKey[] = ["books"];

export interface SignupIntent {
  moduleKeys: ModuleKey[];
  interval: Interval;
  promotionCode?: string;
}

type SearchValue = string | string[] | null | undefined;

function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

/** Public promotion codes are URL-safe, case-insensitive, and intentionally short. */
export function normalizePromotionCode(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || normalized.length > 100 || !/^[A-Z0-9-]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/** Parse a stable, de-duplicated module list in catalog order. */
export function parseSignupModules(
  value: SearchValue,
  fallback: readonly ModuleKey[] = DEFAULT_SIGNUP_MODULES,
): ModuleKey[] {
  const requested = (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((part) => part.split(","))
    .map((part) => part.trim().toLowerCase())
    .filter(isModuleKey);

  const unique = MODULE_KEYS.filter((key) => requested.includes(key));
  return unique.length > 0 ? unique : [...fallback];
}

export function parseSignupIntent(input: {
  modules?: SearchValue;
  interval?: SearchValue;
  promo?: SearchValue;
  coupon?: SearchValue;
}): SignupIntent {
  const intervalValue = first(input.interval);
  const promotionCode = normalizePromotionCode(first(input.promo) ?? first(input.coupon));
  return {
    moduleKeys: parseSignupModules(input.modules),
    interval: intervalValue === "annual" ? "annual" : "monthly",
    ...(promotionCode ? { promotionCode } : {}),
  };
}

/** Same-origin path used by password and magic-link signup continuations. */
export function onboardingPath(intent: SignupIntent): string {
  const params = new URLSearchParams({
    modules: MODULE_KEYS.filter((key) => intent.moduleKeys.includes(key)).join(","),
    interval: intent.interval,
  });
  const promotionCode = normalizePromotionCode(intent.promotionCode);
  if (promotionCode) params.set("promo", promotionCode);
  return `/onboarding?${params.toString()}`;
}

/** Return URL used when a user backs out of Stripe Checkout. */
export function billingSetupPath(intent: SignupIntent): string {
  return onboardingPath(intent).replace("/onboarding?", "/billing?");
}
