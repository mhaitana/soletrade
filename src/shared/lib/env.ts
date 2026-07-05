import "server-only";
import { z } from "zod";

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
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

  // Supabase (auth + storage)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Database (Drizzle — Supabase pooled connection)
  DATABASE_URL: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // Stripe Price object ids (recurring) — created by `pnpm stripe:setup`, pasted
  // here. Anchor = Pro $29/mo; module positions 0..3 = $15/$13.50/$12.75/$12.00.
  STRIPE_PRICE_ANCHOR: z.string().optional(),
  STRIPE_PRICE_MODULE_POS_0: z.string().optional(),
  STRIPE_PRICE_MODULE_POS_1: z.string().optional(),
  STRIPE_PRICE_MODULE_POS_2: z.string().optional(),
  STRIPE_PRICE_MODULE_POS_3: z.string().optional(),

  // Email (Resend)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().optional(),

  // SMS (Twilio) — optional
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // AI layer
  AI_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
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
