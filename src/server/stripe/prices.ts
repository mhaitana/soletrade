import "server-only";
import { env } from "@/shared/lib/env";
import { getStripe } from "./client";
import { PRICING_CATALOG, stackDiscountRate } from "@/platform/billing/pricing";

/**
 * Stripe Price resolution (brief §4 — anchor app + add-on stack discount).
 *
 * The Pro plan is one recurring Stripe subscription with a fixed anchor Price
 * ($29/mo) plus a per-module subscription item. Each module position maps to its
 * own recurring Price so the **stack discount is frozen at enable time**: a
 * module enabled as the 2nd add-on keeps its 10%-off Price for its lifetime even
 * if an earlier module is later removed. Re-enabling a module computes a fresh
 * position from the *current* active module count and uses the corresponding
 * Price. The per-item Price is immutable in Stripe, so no custom repricing logic
 * is needed on remove.
 *
 * The amounts are derived from `PRICING_CATALOG` (single source of truth) — the
 * `stripe:setup` script creates the Price objects from the catalog so the Stripe
 * dashboard can never drift from the public `/pricing` page.
 *
 * Module positions: 0 = 1st module (0% off), 1 = 2nd (10% off), 2 = 3rd (15% off),
 * 3 = 4th+ (20% off, clamped). Positions beyond 3 reuse the position-3 Price.
 */

export const MODULE_PRICE_POSITIONS = 4;

/** Recurring Price id for the Pro anchor ($29/mo). Throws if unset. */
export function getProAnchorPriceId(): string {
  const id = env.STRIPE_PRICE_ANCHOR;
  if (!id) {
    throw new Error(
      "STRIPE_PRICE_ANCHOR is not configured. Run `pnpm stripe:setup` and paste the printed price IDs into .env.local.",
    );
  }
  return id;
}

/**
 * Recurring Price id for the module at `position` (0-indexed). Clamps to
 * `[0, MODULE_PRICE_POSITIONS - 1]` so positions beyond the configured slots reuse
 * the last (deepest-discount) Price. Throws if the slot env var is unset.
 */
export function getModulePriceId(position: number): string {
  const clamped = Math.min(Math.max(position, 0), MODULE_PRICE_POSITIONS - 1);
  const key = `STRIPE_PRICE_MODULE_POS_${clamped}` as keyof typeof env;
  const id = env[key];
  if (!id) {
    throw new Error(
      `${key} is not configured. Run \`pnpm stripe:setup\` and paste the module price IDs into .env.local.`,
    );
  }
  return id;
}

/**
 * The cents each module position bills at — derived from the pricing engine, the
 * single source of truth. Used by `stripe:setup` to create Price objects and by
 * tests to assert env ↔ catalog linkage (pos0=1500, pos1=1350, pos2=1275, pos3=1200).
 */
export function modulePriceCentsForPosition(position: number): number {
  const gross = PRICING_CATALOG.tiers.pro.modulePriceCents;
  const rate = stackDiscountRate(Math.min(Math.max(position, 0), MODULE_PRICE_POSITIONS - 1));
  return gross - Math.round(gross * rate);
}

/** The anchor amount in cents — single source of truth for `stripe:setup`. */
export const PRO_ANCHOR_CENTS = PRICING_CATALOG.tiers.pro.anchorCents;
export const MODULE_CURRENCY = PRICING_CATALOG.currency.toLowerCase();

/** Slot keys used as Stripe Price `metadata["soletrade_slot"]` for idempotent lookup. */
export const PRICE_SLOTS = {
  anchor: "anchor",
  module0: "module:0",
  module1: "module:1",
  module2: "module:2",
  module3: "module:3",
} as const;

/**
 * Idempotently create-or-reuse the 5 recurring Price objects in Stripe by their
 * `metadata["soletrade_slot"]` tag. Re-running `stripe:setup` reuses existing active
 * prices instead of creating duplicates. Returns the 5 ids so the script can print
 * them for the operator to paste into `.env.local`.
 *
 * Uses the Search API (`stripe.prices.search`) because `stripe.prices.list` does
 * not support metadata filters.
 */
export async function ensureStripePrices(): Promise<{
  anchor: string;
  modules: [string, string, string, string];
}> {
  // Two products keep Stripe invoices clean: a "Pro anchor" line and per-module
  // lines. Looked up by metadata slot so re-runs reuse them.
  const anchorProduct = await findOrCreateProduct(
    "soletrade-pro-anchor",
    "Soletrade Suite — Pro anchor",
  );
  const moduleProduct = await findOrCreateProduct(
    "soletrade-module",
    "Soletrade Suite — add-on module",
  );

  const anchor = await findOrCreatePrice({
    slot: PRICE_SLOTS.anchor,
    productId: anchorProduct.id,
    amountCents: PRO_ANCHOR_CENTS,
  });
  const module0 = await findOrCreatePrice({
    slot: PRICE_SLOTS.module0,
    productId: moduleProduct.id,
    amountCents: modulePriceCentsForPosition(0),
  });
  const module1 = await findOrCreatePrice({
    slot: PRICE_SLOTS.module1,
    productId: moduleProduct.id,
    amountCents: modulePriceCentsForPosition(1),
  });
  const module2 = await findOrCreatePrice({
    slot: PRICE_SLOTS.module2,
    productId: moduleProduct.id,
    amountCents: modulePriceCentsForPosition(2),
  });
  const module3 = await findOrCreatePrice({
    slot: PRICE_SLOTS.module3,
    productId: moduleProduct.id,
    amountCents: modulePriceCentsForPosition(3),
  });

  return { anchor, modules: [module0, module1, module2, module3] };
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
    metadata: { soletrade_product: slug },
  });
  return product;
}

async function findOrCreatePrice(opts: {
  slot: string;
  productId: string;
  amountCents: number;
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
    recurring: { interval: "month" },
    metadata: { soletrade_slot: opts.slot },
  });
  return price.id;
}
