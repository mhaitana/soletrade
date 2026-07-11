import "server-only";
import { z } from "zod";
import { MODULE_KEYS } from "@/shared/constants/modules";

/**
 * Server-side environment variable validation.
 *
 * All server-only secrets are optional so the app can boot locally without
 * external services configured (Phase 0 acceptance). Modules that require a
 * given secret should assert its presence at their own boundary.
 *
 * Public (browser) env must be prefixed with NEXT_PUBLIC_ and is validated
 * here too for a single source of truth — but importing this module from
 * client code is blocked by `server-only`.
 */

/**
 * Stripe Price object id env keys — one per (module × role × interval). Brief §10.1
 * gives every module a standalone and an add-on price, each in monthly and annual
 * recurring variants = 4 modules × 2 roles × 2 intervals = 16 ids. `pnpm stripe:setup`
 * creates the Price objects and prints these keys for `.env.local`. Generated here
 * (not hand-listed) so the schema stays in sync with the module catalog.
 */
const ROLES = ["standalone", "addon"] as const;
const INTERVALS = ["monthly", "annual"] as const;
const stripePriceKeyShape: Record<string, z.ZodOptional<z.ZodString>> = {};
for (const moduleKey of MODULE_KEYS) {
  for (const role of ROLES) {
    for (const interval of INTERVALS) {
      stripePriceKeyShape[
        `STRIPE_PRICE_${moduleKey.toUpperCase()}_${role.toUpperCase()}_${interval.toUpperCase()}`
      ] = z.string().optional();
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Supabase (auth + storage)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Postgres connection string used ONLY by integration tests (the HAS_DB gate +
  // setup.ts TCP probe). The app's data client uses NEXT_PUBLIC_SUPABASE_URL +
  // SUPABASE_SERVICE_ROLE_KEY (PostgREST), not a direct Postgres connection.
  DATABASE_URL: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // 16 Stripe Price object ids (module × role × interval) — see stripePriceKeyShape.
  ...stripePriceKeyShape,
  // 5b: shared bearer secret for the /api/cron/invoice-overdue route (Vercel Cron sends it
  // as `Authorization: Bearer <secret>`). Optional — the cron route 401s if unset/mismatched.
  CRON_SECRET: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // SMS (Twilio) — optional
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // AI layer (Phase 10). `mock` needs no key (canned text from real workspace data);
  // `anthropic`/`openai` throw at the provider boundary if their key is unset. Model ids
  // are configurable so a newer Claude/GPT release can be opted into without a code change.
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5"),
  OPENAI_MODEL: z.string().default("gpt-4o"),
  /**
   * Per-extraction credit cost in integer cents (Wave 2). 0 = free (dev default). When > 0,
   * `extractReceipt` consumes this many credits before calling the model; insufficient credit
   * throws and the extraction is rejected with a clear error. Production can set this to
   * meter receipt processing against the workspace's credit balance.
   */
  RECEIPT_EXTRACTION_COST_CENTS: z.coerce.number().int().min(0).default(0),

  // Rate limiting (Phase 11a). When both Upstash REST creds are set, the rate
  // limiter uses @upstash/ratelimit (shared across serverless replicas). When
  // unset, it falls back to the in-memory fixed-window counter (dev/test only —
  // per-instance, unsafe across replicas).
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Supabase Storage bucket for the Files platform (Phase 11b). The bucket must
  // exist in your Supabase project; the server uses the service-role key so RLS
  // is defense-in-depth (workspace scoping is enforced in code, not at Storage).
  SUPABASE_STORAGE_BUCKET: z.string().default("files"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  // Treat empty strings as unset — `KEY=` lines in .env files are common and
  // should not fail validation (e.g. EMAIL_FROM="" must not trip `.email()`).
  const input: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    input[key] = value === "" ? undefined : value;
  }
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables:",
      JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
    );
    throw new Error("Invalid environment variables — see logs above.");
  }
  return parsed.data;
}

/** Validated, typed environment. Import only from server code. */
export const env = parseEnv();
