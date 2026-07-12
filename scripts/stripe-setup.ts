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
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `Module._resolveFilename` is a private Node loader hook (not in the @types/node public
// surface), so declare the minimal shape we use.
type ModuleLoader = typeof Module & {
  _resolveFilename(request: string, parent: unknown, options: unknown, isMain: boolean): string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _cache: any;
};

// Stub `server-only` before any server module is imported. `server-only` is a Next-bundler
// guard that throws under plain Node (tsx uses the `default` export condition; only Next's
// server build applies `react-server`, which maps it to an empty module). We redirect it to an
// empty CJS stub - see `scripts/stubs/server-only.js` for why we don't use `--conditions
// react-server` (it routes `react` to its RSC build and breaks lucide-react).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverOnlyStub = path.resolve(__dirname, "stubs/server-only.js");
const loader = Module as unknown as ModuleLoader;
const origResolveFilename = loader._resolveFilename.bind(loader);
loader._resolveFilename = function (
  request: string,
  parent: unknown,
  options: unknown,
  isMain: boolean,
): string {
  if (request === "server-only") return serverOnlyStub;
  return origResolveFilename(request, parent, options, isMain);
};

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
