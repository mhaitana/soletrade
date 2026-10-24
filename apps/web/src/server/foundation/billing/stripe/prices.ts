import "server-only";
import { env } from "@/server/infrastructure/config/env";
import { brand } from "@/config/brand";
import { getStripe } from "@/server/infrastructure/stripe/client";
import {
  MODULE_PRICES,
  PRICING_CATALOG,
  type Interval,
  type Role,
} from "@/lib/domain/billing/pricing";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/config/modules";

/**
 * Stripe Price resolution (brief §10 - anchor app + add-on stack discount).
 *
 * Each module has FOUR recurring Stripe Prices: standalone × add-on, each in monthly
 * and annual variants. The anchor app (highest-standalone active module) is billed at
 * its standalone price; every other active module is billed at its add-on price. The
 * per-(module × role × interval) Price ids live in env (`STRIPE_PRICE_<MODULE>_<ROLE>_<INTERVAL>`),
 * created idempotently by `pnpm stripe:setup`.
 *
 * Amounts are derived from `MODULE_PRICES` (single source of truth) so the Stripe
 * dashboard can never drift from the public `/pricing` page.
 */

export type { Interval, Role } from "@/lib/domain/billing/pricing";

/** The 16 env-key suffixes (module × role × interval) used as Stripe Price slot tags. */
export function priceSlot(moduleKey: ModuleKey, role: Role, interval: Interval): string {
  return `${moduleKey}:${role}:${interval}`;
}

/** Build the env var name for a (module × role × interval) Price id. */
export function priceEnvKey(moduleKey: ModuleKey, role: Role, interval: Interval): string {
  return `STRIPE_PRICE_${moduleKey.toUpperCase()}_${role.toUpperCase()}_${interval.toUpperCase()}`;
}

/**
 * Recurring Price id for a (module × role × interval). Throws a clear, actionable
 * boundary error if the env var is unset so misconfiguration surfaces before any
 * Stripe API call.
 */
export function getModulePriceId(moduleKey: ModuleKey, role: Role, interval: Interval): string {
  const key = priceEnvKey(moduleKey, role, interval);
  const id = (env as unknown as Record<string, string | undefined>)[key];
  if (!id) {
    throw new Error(
      `${key} is not configured. Run \`pnpm stripe:setup\` and paste the printed price IDs into .env.local.`,
    );
  }
  return id;
}

/**
 * The cents a (module × role × interval) Price bills at - derived from `MODULE_PRICES`,
 * the single source of truth. Used by `stripe:setup` to create Price objects and by tests
 * to assert env ↔ catalog linkage.
 */
export function modulePriceCents(moduleKey: ModuleKey, role: Role, interval: Interval): number {
  return MODULE_PRICES[moduleKey][role][interval];
}

export const MODULE_CURRENCY = PRICING_CATALOG.currency.toLowerCase();

/** Reverse map: Stripe Price id → { moduleKey, role }. Interval comes from the
 * subscription's metadata at reconcile time, so it isn't included here. Used by the
 * `checkout.session.completed` webhook to map subscription items back to modules. */
export interface PriceIdMapping {
  moduleKey: ModuleKey;
  role: Role;
}

export function buildPriceIdToModuleMap(): Map<string, PriceIdMapping> {
  const map = new Map<string, PriceIdMapping>();
  for (const moduleKey of MODULE_KEYS) {
    for (const role of ["standalone", "addon"] as const) {
      for (const interval of ["monthly", "annual"] as const) {
        const id = (env as unknown as Record<string, string | undefined>)[
          priceEnvKey(moduleKey, role, interval)
        ];
        if (id) map.set(id, { moduleKey, role });
      }
    }
  }
  return map;
}

/** The full Price-id map `Record<ModuleKey, Record<Role, Record<Interval, string>>>`,
 * resolved from env. Throws on the first unset key (fail-fast - callers run this only
 * when all prices must be present, e.g. `stripe:setup`). */
export type PriceIdMap = Record<ModuleKey, Record<Role, Record<Interval, string>>>;

export function resolveAllPriceIds(): PriceIdMap {
  const map = {} as PriceIdMap;
  for (const moduleKey of MODULE_KEYS) {
    map[moduleKey] = {
      standalone: {
        monthly: getModulePriceId(moduleKey, "standalone", "monthly"),
        annual: getModulePriceId(moduleKey, "standalone", "annual"),
      },
      addon: {
        monthly: getModulePriceId(moduleKey, "addon", "monthly"),
        annual: getModulePriceId(moduleKey, "addon", "annual"),
      },
    };
  }
  return map;
}

/**
 * Idempotently create-or-reuse the 16 recurring Price objects (4 modules × 2 roles ×
 * 2 intervals) in Stripe, tagged by `metadata["soletrade_slot"] = "<module>:<role>:<interval>"`.
 * Re-running `stripe:setup` reuses existing active prices instead of creating duplicates.
 * Uses the Search API (`stripe.prices.search`) because `stripe.prices.list` does not
 * support metadata filters.
 *
 * Returns the 16-id map so the script can print the env-key=value lines to paste.
 */
export async function ensureStripePrices(): Promise<PriceIdMap> {
  const map = {} as PriceIdMap;
  for (const moduleKey of MODULE_KEYS) {
    // One Stripe Product per module keeps invoices clean (4 products, 4 prices each).
    // The product id stays `soletrade-*` (a stable lookup key) even though the product
    // display name is `Soletrade - *`; changing the id would orphan existing Stripe
    // products and subscriptions. NB: `findOrCreateProduct` reuses existing products by metadata
    // without renaming them. Future rebrands need separate Product name updates - see
    // docs/DEPLOYMENT.md for the verified Soletrade rename record.
    const product = await findOrCreateProduct(
      `soletrade-${moduleKey}`,
      `${brand.productName} - ${MODULES[moduleKey].name}`,
    );
    map[moduleKey] = {
      standalone: {
        monthly: await findOrCreatePrice({
          slot: priceSlot(moduleKey, "standalone", "monthly"),
          productId: product.id,
          amountCents: modulePriceCents(moduleKey, "standalone", "monthly"),
          interval: "month",
        }),
        annual: await findOrCreatePrice({
          slot: priceSlot(moduleKey, "standalone", "annual"),
          productId: product.id,
          amountCents: modulePriceCents(moduleKey, "standalone", "annual"),
          interval: "year",
        }),
      },
      addon: {
        monthly: await findOrCreatePrice({
          slot: priceSlot(moduleKey, "addon", "monthly"),
          productId: product.id,
          amountCents: modulePriceCents(moduleKey, "addon", "monthly"),
          interval: "month",
        }),
        annual: await findOrCreatePrice({
          slot: priceSlot(moduleKey, "addon", "annual"),
          productId: product.id,
          amountCents: modulePriceCents(moduleKey, "addon", "annual"),
          interval: "year",
        }),
      },
    };
  }
  return map;
}

async function findOrCreateProduct(slug: string, name: string): Promise<{ id: string }> {
  const stripe = getStripe();
  const found = await stripe.products.search({
    query: `active:"true" AND metadata["soletrade_product"]:"${slug}"`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0];
  const product = await stripe.products.create({
    name,
    statement_descriptor: brand.stripeStatementDescriptor,
    metadata: { soletrade_product: slug },
  });
  return product;
}

async function findOrCreatePrice(opts: {
  slot: string;
  productId: string;
  amountCents: number;
  interval: "month" | "year";
}): Promise<string> {
  const stripe = getStripe();
  const found = await stripe.prices.search({
    query: `active:"true" AND metadata["soletrade_slot"]:"${opts.slot}"`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0].id;
  const price = await stripe.prices.create({
    product: opts.productId,
    unit_amount: opts.amountCents,
    currency: MODULE_CURRENCY,
    recurring: { interval: opts.interval },
    metadata: { soletrade_slot: opts.slot },
  });
  return price.id;
}
