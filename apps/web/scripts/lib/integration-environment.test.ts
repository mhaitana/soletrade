// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateIntegrationEnvironment } from "./integration-environment";

const local = {
  DATABASE_URL: "postgres://postgres:local@127.0.0.1:56422/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:56421",
  SUPABASE_SERVICE_ROLE_KEY: "local-test-key",
};

describe("integration test environment", () => {
  it("requires both a local database and local Supabase API", () => {
    expect(() => validateIntegrationEnvironment(local)).not.toThrow();
    expect(() =>
      validateIntegrationEnvironment({
        ...local,
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      }),
    ).toThrow(/local/);
    expect(() =>
      validateIntegrationEnvironment({
        ...local,
        DATABASE_URL: "postgres://user:pass@example.com/db",
      }),
    ).toThrow(/local/);
    expect(() =>
      validateIntegrationEnvironment({ ...local, SUPABASE_SERVICE_ROLE_KEY: "" }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
  it("requires Stripe test credentials and both prices for the live Stripe suite", () => {
    expect(() => validateIntegrationEnvironment(local, true)).toThrow(/test-mode/);
    expect(() =>
      validateIntegrationEnvironment({ ...local, STRIPE_SECRET_KEY: "sk_live_placeholder" }, true),
    ).toThrow(/test-mode/);
    const stripe = { ...local, STRIPE_SECRET_KEY: "sk_test_placeholder" };
    expect(() => validateIntegrationEnvironment(stripe, true)).toThrow(/STRIPE_PRICE/);
    expect(() =>
      validateIntegrationEnvironment(
        {
          ...stripe,
          STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY: "price_test_books",
          STRIPE_PRICE_INVOICES_ADDON_MONTHLY: "price_test_invoices",
        },
        true,
      ),
    ).not.toThrow();
  });
});
