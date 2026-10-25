// @vitest-environment node
import { describe, expect, it } from "vitest";
import { prepareE2EEnvironment, validateE2ETarget } from "./e2e-environment";

const config = `[api]\nport = 56421\n[db]\nport = 56422\n`;
const local = {
  DATABASE_URL: "postgres://postgres:local@127.0.0.1:56422/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56421",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-key",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3109",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3109",
};

describe("E2E environment isolation", () => {
  it("uses the explicit file target instead of inherited application credentials", () => {
    const result = prepareE2EEnvironment(local, config, {
      NEXT_PUBLIC_SUPABASE_URL: "https://hosted.example.com",
      SUPABASE_SERVICE_ROLE_KEY: "inherited-key",
      PATH: "/bin",
    });
    expect(result.env.NEXT_PUBLIC_SUPABASE_URL).toBe(local.NEXT_PUBLIC_SUPABASE_URL);
    expect(result.env.SUPABASE_SERVICE_ROLE_KEY).toBe(local.SUPABASE_SERVICE_ROLE_KEY);
    expect(result.env.PATH).toBe("/bin");
    expect(result.baseURL).toBe("http://127.0.0.1:3109");
    expect(result.hostname).toBe("127.0.0.1");
    expect(result.port).toBe(3109);
  });

  it("requires complete local credentials in the explicit file", () => {
    expect(() =>
      prepareE2EEnvironment({ ...local, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }, config),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    expect(() =>
      prepareE2EEnvironment({ ...local, SUPABASE_SERVICE_ROLE_KEY: "" }, config, {
        SUPABASE_SERVICE_ROLE_KEY: "inherited-key",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL", "https://hosted.example.com"],
    ["DATABASE_URL", "postgres://postgres:local@hosted.example.com/postgres"],
    ["PLAYWRIGHT_BASE_URL", "https://business.example.com"],
    ["PLAYWRIGHT_BASE_URL", "http://127.0.0.1:3109/another-app"],
  ])("rejects a nonlocal or non-root %s", (key, value) => {
    expect(() => validateE2ETarget({ ...local, [key]: value }, config)).toThrow();
  });

  it("rejects local services belonging to a different Supabase stack", () => {
    expect(() =>
      validateE2ETarget({ ...local, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }, config),
    ).toThrow(/api.*port/i);
    expect(() =>
      validateE2ETarget(
        { ...local, DATABASE_URL: "postgres://postgres:local@127.0.0.1:54322/postgres" },
        config,
      ),
    ).toThrow(/database.*port/i);
  });

  it("requires generated app links to use the Playwright origin", () => {
    expect(() =>
      validateE2ETarget({ ...local, NEXT_PUBLIC_APP_URL: "http://localhost:3000" }, config),
    ).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("disables external transports even when inherited or specified in the file", () => {
    const result = prepareE2EEnvironment(
      { ...local, RESEND_API_KEY: "file-key", STRIPE_SECRET_KEY: "sk_test_unused" },
      config,
      { AI_PROVIDER: "openai", OPENAI_API_KEY: "inherited-key", TWILIO_AUTH_TOKEN: "sms-key" },
    );
    expect(result.env.AI_PROVIDER).toBe("mock");
    for (const key of [
      "RESEND_API_KEY",
      "STRIPE_SECRET_KEY",
      "OPENAI_API_KEY",
      "TWILIO_AUTH_TOKEN",
    ])
      expect(result.env[key]).toBe("");
    expect(result.env.UPSTASH_REDIS_REST_URL).toBe("");
    expect(result.env.ANTHROPIC_API_KEY).toBe("");
  });
});
