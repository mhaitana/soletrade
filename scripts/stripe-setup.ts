/**
 * Idempotent Stripe price-seeding script.
 *
 * Creates-or-reuses 16 recurring Price objects (4 modules × standalone/add-on ×
 * monthly/annual) by their `metadata["soletrade_slot"]` tag, then prints the 16 price
 * IDs to paste into `.env.local`.
 *
 *   pnpm stripe:setup
 *
 * Requires STRIPE_SECRET_KEY in .env.local (sk_test_… for test mode). Re-runnable:
 * existing active prices tagged with the slot are reused, not duplicated. Amounts
 * come from `MODULE_PRICES` (the single source of truth), so the Stripe dashboard
 * can never drift from the public `/pricing` page.
 */
import { loadEnvConfig } from "@next/env";

// Load .env.local / .env into process.env before importing the server modules
// (env.ts reads process.env once at import).
loadEnvConfig(process.cwd());

async function main() {
  const { ensureStripePrices } = await import("../src/server/stripe/prices");
  const { MODULE_KEYS } = await import("../src/shared/constants/modules");
  const result = await ensureStripePrices();
  console.log("\n✅ Stripe prices ready. Paste these into .env.local:\n");
  const roles = ["standalone", "addon"] as const;
  const intervals = ["monthly", "annual"] as const;
  for (const moduleKey of MODULE_KEYS) {
    for (const role of roles) {
      for (const interval of intervals) {
        const envKey = `STRIPE_PRICE_${moduleKey.toUpperCase()}_${role.toUpperCase()}_${interval.toUpperCase()}`;
        console.log(`${envKey}=${result[moduleKey][role][interval]}`);
      }
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ stripe:setup failed:", err);
  process.exit(1);
});
