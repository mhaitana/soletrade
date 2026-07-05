import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boundary unit tests for the Stripe client + webhook verifier + webhook route.
 * No network, no real Stripe keys required — these assert the boundary
 * behaviour: missing-secret errors surface clearly, and signature failures map
 * to 400.
 *
 * The env module reads `process.env.STRIPE_*` once at import via the shared env
 * parser (which treats empty strings as unset). To test the unset-key path we
 * `vi.resetModules()` and re-import with the env var removed, restoring it
 * afterwards so other suites are unaffected.
 */

const ORIGINAL_SECRET = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

async function freshImportClient() {
  vi.resetModules();
  return (await import("./client")) as typeof import("./client");
}

async function freshImportWebhooks() {
  vi.resetModules();
  return (await import("./webhooks")) as typeof import("./webhooks");
}

async function freshImportRoute() {
  vi.resetModules();
  return (await import("@/app/api/stripe/webhooks/route")) as typeof import("@/app/api/stripe/webhooks/route");
}

function restoreEnv() {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_SECRET;
  if (ORIGINAL_WEBHOOK_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_WEBHOOK_SECRET;
}

describe("Stripe client boundary", () => {
  afterEach(() => restoreEnv());

  it("throws a clear boundary error when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe } = await freshImportClient();
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY is not configured/);
  });

  it("constructs a Stripe client when the key is set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary_placeholder";
    const { getStripe } = await freshImportClient();
    const client = getStripe();
    expect(typeof client.webhooks.constructEvent).toBe("function");
  });
});

describe("verifyStripeWebhook boundary", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_boundary_placeholder";
  });
  afterEach(() => restoreEnv());

  it("throws a boundary error when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { verifyStripeWebhook } = await freshImportWebhooks();
    expect(() => verifyStripeWebhook("{}", "t=1,v1=bad")).toThrow(
      /STRIPE_WEBHOOK_SECRET is not configured/,
    );
  });

  it("throws StripeSignatureMissingError when the signature header is null", async () => {
    const { verifyStripeWebhook, StripeSignatureMissingError } = await freshImportWebhooks();
    expect(() => verifyStripeWebhook("{}", null)).toThrow(StripeSignatureMissingError);
  });

  it("rejects a malformed signature (constructEvent throws a verification error)", async () => {
    const { verifyStripeWebhook, isStripeSignatureError } = await freshImportWebhooks();
    let caught: unknown;
    try {
      verifyStripeWebhook('{"id":"evt_test"}', "t=12345,v1=not_a_real_signature");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(isStripeSignatureError(caught)).toBe(true);
  });
});

describe("Stripe webhook route", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_boundary_placeholder";
  });
  afterEach(() => restoreEnv());

  it("returns 400 when the stripe-signature header is missing", async () => {
    const { POST } = await freshImportRoute();
    const request = new Request("http://localhost/api/stripe/webhooks", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("returns 400 when the signature fails verification", async () => {
    const { POST } = await freshImportRoute();
    const request = new Request("http://localhost/api/stripe/webhooks", {
      method: "POST",
      body: '{"id":"evt_test","type":"invoice.paid"}',
      headers: { "stripe-signature": "t=12345,v1=definitely_invalid" },
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is unset (server misconfiguration)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { POST } = await freshImportRoute();
    const request = new Request("http://localhost/api/stripe/webhooks", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=x" },
    });
    const res = await POST(request);
    expect(res.status).toBe(500);
  });
});
