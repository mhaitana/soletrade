import { validateIntegrationEnvironment } from "./integration-environment";

type Environment = Record<string, string | undefined>;

function localHttpOrigin(value: string | undefined, key: string): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error(`E2E requires a valid local ${key}.`);
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`E2E requires a local HTTP origin for ${key}.`);
  }
  return url;
}

function configuredPort(source: string, section: "api" | "db"): number {
  const body = source.match(
    new RegExp(`^\\[${section}\\]\\s*$([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, "m"),
  )?.[1];
  const port = Number(body?.match(/^port\s*=\s*(\d+)\s*(?:#.*)?$/m)?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`E2E could not read the ${section} port from supabase/config.toml.`);
  }
  return port;
}

/** Check the app and disposable database target before starting or resetting services. */
export function validateE2ETarget(values: Environment, supabaseConfig: string) {
  validateIntegrationEnvironment(values);
  if (!values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("E2E requires NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  const base = localHttpOrigin(values.PLAYWRIGHT_BASE_URL, "PLAYWRIGHT_BASE_URL");
  const app = localHttpOrigin(values.NEXT_PUBLIC_APP_URL, "NEXT_PUBLIC_APP_URL");
  if (app.origin !== base.origin) {
    throw new Error("E2E requires NEXT_PUBLIC_APP_URL to match PLAYWRIGHT_BASE_URL.");
  }
  const api = localHttpOrigin(values.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  if (Number(api.port || "80") !== configuredPort(supabaseConfig, "api")) {
    throw new Error("E2E Supabase API port must match this repository's supabase/config.toml.");
  }
  const database = new URL(values.DATABASE_URL!);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    Number(database.port || "5432") !== configuredPort(supabaseConfig, "db")
  ) {
    throw new Error("E2E database port must match this repository's supabase/config.toml.");
  }
  return {
    baseURL: base.origin,
    hostname: base.hostname.replace(/^\[|\]$/g, ""),
    port: Number(base.port || "80"),
  };
}

/** File values override inherited application configuration; external transports stay off. */
export function prepareE2EEnvironment(
  fileValues: Environment,
  supabaseConfig: string,
  inherited: Environment = {},
) {
  const target = validateE2ETarget(fileValues, supabaseConfig);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...inherited, ...fileValues })) {
    if (value !== undefined) env[key] = value;
  }

  // Explicit empty values prevent Next's development .env.local from restoring
  // real transports. E2E exercises business flows with local storage and mock AI.
  for (const key of [
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ]) {
    env[key] = "";
  }
  env.AI_PROVIDER = "mock";
  env.APP_URL = target.baseURL;
  return { ...target, env };
}
