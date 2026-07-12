import { MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";

/**
 * Pricing engine (brief §10 - anchor app + add-on stack discount). Pure: no
 * `server-only`, no DB, no I/O - safe to unit-test and to import from client
 * components (the public /pricing page does exactly that). All money is integer
 * cents to avoid floating-point drift; the catalog is the single source of truth
 * for prices and is trivially editable.
 *
 * Model:
 *   - No Free/Pro tier. Each workspace's active modules are billed together.
 *   - The **anchor app** = the active module with the highest standalone price; it
 *     is charged its **standalone** price. All other active modules are charged their
 *     **add-on** price (standalone − flat $2.50/mo, or − $22.50/yr = $2.50 × 9).
 *   - Two billing intervals: monthly and annual (annual = 9× monthly, 3 months free).
 *
 * The engine is pure arithmetic - it does not decide policy (whether a workspace may
 * add a module is gated by the billing/subscription state in the lifecycle service).
 */

/** Billing interval (brief §10.1 - monthly and annual). Annual = 9 paid months. */
export type Interval = "monthly" | "annual";

/** A module's role in a workspace's billing for the current cycle. */
export type Role = "standalone" | "addon";

/** A module's price set: standalone (when it is the anchor) and add-on (otherwise),
 * each across both billing intervals. All values are integer cents. */
export interface ModulePriceSet {
  standalone: Record<Interval, number>;
  addon: Record<Interval, number>;
}

/**
 * Per-product launch prices (brief §10.1), in integer cents. The add-on price embeds
 * the flat $2.50/mo stack discount (annual: $22.50/yr = $2.50 × 9). Annual standalone
 * equals 9× the monthly standalone (3 months free); same for add-on.
 */
export const MODULE_PRICES: Record<ModuleKey, ModulePriceSet> = {
  books: {
    standalone: { monthly: 900, annual: 8100 },
    addon: { monthly: 650, annual: 5850 },
  },
  quotes: {
    standalone: { monthly: 800, annual: 7200 },
    addon: { monthly: 550, annual: 4950 },
  },
  drive: {
    standalone: { monthly: 700, annual: 6300 },
    addon: { monthly: 450, annual: 4050 },
  },
  invoices: {
    standalone: { monthly: 600, annual: 5400 },
    addon: { monthly: 350, annual: 3150 },
  },
};

/** Stack discount per add-on module, by interval (brief §10.2). Derived from the
 * catalog so it can never drift: standalone − addon for any module. */
export const STACK_DISCOUNT_CENTS: Record<Interval, number> = {
  monthly: MODULE_PRICES.books.standalone.monthly - MODULE_PRICES.books.addon.monthly, // 250
  annual: MODULE_PRICES.books.standalone.annual - MODULE_PRICES.books.addon.annual, // 2250
};

/** Currency for all prices (single source of truth; used by `formatCents` default). */
export const PRICING_CATALOG = {
  currency: "AUD",
} as const;

export interface ModulePriceBreakdown {
  key: ModuleKey;
  role: Role;
  /** The standalone price for this module at the interval - what it would cost as anchor. */
  grossCents: number;
  /** The stack discount applied (standalone − addon). 0 for the anchor. */
  discountCents: number;
  /** What this module actually bills at: standalone for the anchor, addon for others. */
  netCents: number;
}

export interface PricingBreakdown {
  interval: Interval;
  currency: string;
  /** The anchor module key, or null when the set is empty (workspace is unbilled). */
  anchorKey: ModuleKey | null;
  modules: ModulePriceBreakdown[];
  totalDiscountCents: number;
  totalCents: number;
}

/**
 * Select the anchor app: the active module with the highest standalone monthly price.
 * Ties break by `MODULE_KEYS` order (stable, deterministic). Returns `null` for an
 * empty set (the workspace has no modules and is therefore unbilled).
 *
 * Brief §10.3 pricing priority: Books ($9) > Quotes ($8) > Drive ($7) > Invoices ($6).
 */
export function selectAnchor(moduleKeys: readonly ModuleKey[]): ModuleKey | null {
  if (moduleKeys.length === 0) return null;
  let anchor: ModuleKey | null = null;
  let anchorCents = -1;
  // Iterate in MODULE_KEYS order so ties resolve to the earliest (highest-priority) module.
  for (const candidate of MODULE_KEYS) {
    if (!moduleKeys.includes(candidate)) continue;
    const cents = MODULE_PRICES[candidate].standalone.monthly;
    if (cents > anchorCents) {
      anchor = candidate;
      anchorCents = cents;
    }
  }
  return anchor;
}

/**
 * Price a workspace's active modules for the given interval. The anchor (highest
 * standalone) is charged its standalone price; every other module is charged its
 * add-on price. Pure - does not touch Stripe or the DB.
 */
export function priceSubscription(
  moduleKeys: readonly ModuleKey[],
  interval: Interval,
): PricingBreakdown {
  const anchorKey = selectAnchor(moduleKeys);
  const modules: ModulePriceBreakdown[] = moduleKeys.map((key) => {
    const isAnchor = key === anchorKey;
    const gross = MODULE_PRICES[key].standalone[interval];
    const net = isAnchor
      ? MODULE_PRICES[key].standalone[interval]
      : MODULE_PRICES[key].addon[interval];
    const discountCents = gross - net;
    return {
      key,
      role: isAnchor ? "standalone" : "addon",
      grossCents: gross,
      discountCents,
      netCents: net,
    };
  });
  const totalDiscountCents = modules.reduce((sum, m) => sum + m.discountCents, 0);
  const totalCents = modules.reduce((sum, m) => sum + m.netCents, 0);
  return {
    interval,
    currency: PRICING_CATALOG.currency,
    anchorKey,
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

/**
 * Billing period length in milliseconds (brief §10). Monthly is approximated as 30 days
 * and annual as 365 days - a deliberate approximation so proration is deterministic and
 * avoids calendar-month length / DST edge cases. The refund is off by at most ~one day's
 * worth of value (<4% of one day), which is acceptable for a credit-ledger true-up.
 */
const PERIOD_MS: Record<Interval, number> = {
  monthly: 30 * 86_400_000,
  annual: 365 * 86_400_000,
};

/**
 * The current billing period for a workspace, derived from its anchor billing date.
 * `start` is the most recent anchor anniversary on or before `now`; `end` is one period
 * after that. Defensive: if `anchorBillingDate` is in the future, `start` will be ahead of
 * `now` (callers clamp the fraction). Used by the 4c proration refund.
 */
export function currentBillingPeriod(
  anchorBillingDate: Date,
  interval: Interval,
  now: Date,
): { start: Date; end: Date } {
  const periodMs = PERIOD_MS[interval];
  const anchorMs = anchorBillingDate.getTime();
  const nowMs = now.getTime();
  const periodsSinceAnchor = Math.floor((nowMs - anchorMs) / periodMs);
  const startMs = anchorMs + periodsSinceAnchor * periodMs;
  return { start: new Date(startMs), end: new Date(startMs + periodMs) };
}

/**
 * Pro-rated refund in cents for a module billed at `netCents` over the current billing
 * period, cancelled at `now` (brief §10.2 - 4c cancellation engine). Returns 0 when there
 * is nothing to refund: no anchor date, non-positive net, or the period has elapsed
 * (`now >= end`). The fraction is clamped to [0, 1] so a `now` before the period start
 * refunds the full net (defensive), and a `now` after the end refunds nothing.
 *
 * Pure - safe to unit-test and to import from the server reconcile path.
 */
export function prorateRefundCents(
  netCents: number,
  interval: Interval,
  anchorBillingDate: Date | null,
  now: Date,
): number {
  if (!anchorBillingDate || netCents <= 0) return 0;
  const { start, end } = currentBillingPeriod(anchorBillingDate, interval, now);
  const period = end.getTime() - start.getTime();
  if (period <= 0) return 0;
  const remaining = end.getTime() - now.getTime();
  if (remaining <= 0) return 0; // period elapsed
  const fraction = Math.min(1, Math.max(0, remaining / period));
  return Math.round(netCents * fraction);
}

/**
 * Pro-rated refund for cancelling `moduleKey` right now, given the workspace's active
 * module set + billing state. Resolves the module's role (anchor → standalone, otherwise
 * add-on) from the active set, reads its net price from the catalog, and delegates to
 * `prorateRefundCents`. Returns 0 when the module isn't in the active set or the billing
 * state is missing (no anchor).
 *
 * Single source of truth for "what refund does cancelling this module produce" - used by
 * the single-module cancel path and (per-module) the whole-subscription cancel path.
 */
export function moduleRefundCents(
  moduleKey: ModuleKey,
  activeModules: readonly ModuleKey[],
  interval: Interval,
  anchorBillingDate: Date | null,
  now: Date,
): number {
  if (!activeModules.includes(moduleKey)) return 0;
  const role: Role = selectAnchor(activeModules) === moduleKey ? "standalone" : "addon";
  const netCents = MODULE_PRICES[moduleKey][role][interval];
  return prorateRefundCents(netCents, interval, anchorBillingDate, now);
}

/**
 * Pro-rated charge in cents for adding a module billed at `netCents` mid-cycle at
 * `now` (brief §10.5 - immediate proration charge). Mirrors `prorateRefundCents`:
 * charges for the *remaining* fraction of the current billing period
 * (`netCents × remainingMs / periodMs`). Returns 0 when there is nothing to charge
 * (no anchor date, non-positive net, or the period has elapsed). The fraction is
 * clamped to [0, 1].
 *
 * Used to preview the mid-cycle add cost before the Stripe `subscriptionItems.create`
 * call (which sets `proration_behavior: "always_invoice"` to charge it immediately).
 */
export function prorateChargeCents(
  netCents: number,
  interval: Interval,
  anchorBillingDate: Date | null,
  now: Date,
): number {
  if (!anchorBillingDate || netCents <= 0) return 0;
  const { start, end } = currentBillingPeriod(anchorBillingDate, interval, now);
  const period = end.getTime() - start.getTime();
  if (period <= 0) return 0;
  const remaining = end.getTime() - now.getTime();
  if (remaining <= 0) return 0; // period elapsed
  const fraction = Math.min(1, Math.max(0, remaining / period));
  return Math.round(netCents * fraction);
}

/**
 * Pro-rated charge for adding `moduleKey` to a workspace right now, given its current
 * active module set + billing state (brief §10.5). Resolves the new module's role in
 * the *resulting* set (`selectAnchor([...activeModules, moduleKey])`): if the new module
 * becomes the anchor (highest standalone) it is charged standalone, otherwise add-on.
 * Reads its net price from the catalog and delegates to `prorateChargeCents`. Returns 0
 * when the module is already active or the billing state is missing (no anchor).
 *
 * Also reports the resolved role and whether the new module becomes the anchor, so the
 * UI can show "adding Drive as an add-on" vs "adding Drive as your anchor app".
 */
export function moduleChargeCents(
  moduleKey: ModuleKey,
  activeModules: readonly ModuleKey[],
  interval: Interval,
  anchorBillingDate: Date | null,
  now: Date,
): { proratedCents: number; netCents: number; role: Role; becomesAnchor: boolean } {
  const resultingSet = activeModules.includes(moduleKey)
    ? activeModules
    : [...activeModules, moduleKey];
  const newAnchor = selectAnchor(resultingSet);
  const becomesAnchor = newAnchor === moduleKey;
  const role: Role = becomesAnchor ? "standalone" : "addon";
  const netCents = MODULE_PRICES[moduleKey][role][interval];
  const proratedCents = activeModules.includes(moduleKey)
    ? 0
    : prorateChargeCents(netCents, interval, anchorBillingDate, now);
  return { proratedCents, netCents, role, becomesAnchor };
}
