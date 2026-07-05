/**
 * Idempotent Stripe price-seeding script.
 *
 * Creates-or-reuses 5 recurring Price objects (anchor $29/mo + module positions
 * 0..3 at $15/$13.50/$12.75/$12.00) by their `metadata["soletrade_slot"]` tag, then
 * prints the 5 price IDs to paste into `.env.local`.
 *
 *   pnpm stripe:setup
 *
 * Requires STRIPE_SECRET_KEY in .env.local (sk_test_… for test mode). Re-runnable:
 * existing active prices tagged with the slot are reused, not duplicated.
 */
import { loadEnvConfig } from "@next/env";

// Load .env.local / .env into process.env before importing the server modules
// (env.ts reads process.env once at import).
loadEnvConfig(process.cwd());

async function main() {
  const { ensureStripePrices } = await import("../src/server/stripe/prices");
  const result = await ensureStripePrices();
  console.log("\n✅ Stripe prices ready. Paste these into .env.local:\n");
  console.log(`STRIPE_PRICE_ANCHOR=${result.anchor}`);
  console.log(`STRIPE_PRICE_MODULE_POS_0=${result.modules[0]}`);
  console.log(`STRIPE_PRICE_MODULE_POS_1=${result.modules[1]}`);
  console.log(`STRIPE_PRICE_MODULE_POS_2=${result.modules[2]}`);
  console.log(`STRIPE_PRICE_MODULE_POS_3=${result.modules[3]}\n`);
}

main().catch((err) => {
  console.error("\n❌ stripe:setup failed:", err);
  process.exit(1);
});
