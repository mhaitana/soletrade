/**
 * Idempotent Stripe price-seeding script.
 *
 * Creates-or-reuses 16 recurring Price objects (4 modules × standalone/add-on ×
 * monthly/annual) by their `metadata["soletrade_slot"]` tag, then prints the 16 price
 * IDs to paste into `.env.local`.
 *
 *   pnpm stripe:setup
 *   pnpm stripe:setup --env-file .env.prod
 *   pnpm stripe:setup --prod
 *
 * Requires STRIPE_SECRET_KEY in .env.local (sk_test_… for test mode) or the file
 * passed via --env-file. Re-runnable:
 * existing active prices tagged with the slot are reused, not duplicated. Amounts
 * come from `MODULE_PRICES` (the single source of truth), so the Stripe dashboard
 * can never drift from the public `/pricing` page.
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFileOverride } from "./lib/load-env-file-override";

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

// Parse optional env-file override so stripe:setup can target production
// variables in .env.prod without manual copy/paste. Supports:
//   pnpm stripe:setup --env-file .env.prod
//   pnpm stripe:setup --env-file=.env.prod
//   pnpm stripe:setup --prod
const envFileFlag = (() => {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (!arg) continue;
    if (arg === "--prod") return ".env.prod";
    if (arg === "--env-file") {
      const next = process.argv[i + 1];
      if (next) return next;
    }
    if (arg.startsWith("--env-file=")) return arg.slice("--env-file=".length);
  }
  return null;
})();

// Load .env.local / .env into process.env before importing the server modules
// (env.ts reads process.env once at import).
loadEnvConfig(process.cwd());

// Allow overriding with a custom env file (e.g. --env-file .env.prod).
if (envFileFlag) {
  loadEnvFileOverride(envFileFlag);
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  const mode = key.startsWith("sk_live") ? "live" : key.startsWith("sk_test") ? "test" : "unknown";
  console.log(`\nUsing ${mode} Stripe mode from ${envFileFlag}`);
}

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
