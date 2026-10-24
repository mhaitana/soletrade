/** Guard explicitly invoked destructive integration suites, without exposing credentials. */
export function validateIntegrationEnvironment(
  values: Record<string, string | undefined>,
  stripe = false,
): void {
  for (const key of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!values[key]) throw new Error(`Integration tests require ${key}.`);
  }
  for (const key of ["DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    let hostname: string;
    try {
      hostname = new URL(values[key]!).hostname;
    } catch {
      throw new Error(`Integration tests require a valid local ${key}.`);
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
      throw new Error(`Integration tests require a local ${key}.`);
    }
  }
  if (stripe) {
    if (!values.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
      throw new Error("Stripe integration tests require test-mode credentials.");
    }
    for (const key of [
      "STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY",
      "STRIPE_PRICE_INVOICES_ADDON_MONTHLY",
    ]) {
      if (!values[key]) throw new Error(`Stripe integration tests require ${key}.`);
    }
  }
}
