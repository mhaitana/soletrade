import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Boundary tests for the Stripe lifecycle service. No network, no DB.
 *
 * Asserts the env-boundary errors surface clearly when Stripe/price secrets are
 * unset. To test the unset path we set/unset process.env, register `vi.doMock`
 * for the DB-touching deps, `vi.resetModules()`, then dynamic-import — the order
 * matters: mocks must be registered before the module resolves its imports.
 */

const ORIGINAL = {
  SECRET: process.env.STRIPE_SECRET_KEY,
  ANCHOR: process.env.STRIPE_PRICE_ANCHOR,
  POS_0: process.env.STRIPE_PRICE_MODULE_POS_0,
};

function restoreEnv() {
  for (const [key, val] of Object.entries(ORIGINAL)) {
    if (val === undefined) delete process.env[key];
    else (process.env as Record<string, string | undefined>)[key] = val;
  }
}

async function importWithMocks(opts: {
  subscription?: object;
  installedModules?: string[];
}): Promise<typeof import("./stripe-lifecycle")> {
  vi.resetModules();
  vi.doMock("@/platform/billing/subscriptions", () => ({
    ensureSubscription: vi.fn().mockResolvedValue(opts.subscription ?? { workspaceId: "ws_test" }),
    getSubscription: vi.fn().mockResolvedValue(opts.subscription ?? { workspaceId: "ws_test" }),
  }));
  vi.doMock("@/platform/module-installations", () => ({
    getInstalledModules: vi.fn().mockResolvedValue(opts.installedModules ?? []),
  }));
  return (await import("./stripe-lifecycle")) as typeof import("./stripe-lifecycle");
}

describe("createProCheckoutSession boundary", () => {
  afterEach(() => restoreEnv());

  it("throws a clear error when STRIPE_PRICE_ANCHOR is unset", async () => {
    delete process.env.STRIPE_PRICE_ANCHOR;
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    const mod = await importWithMocks({ subscription: { workspaceId: "ws_test" } });
    await expect(
      mod.createProCheckoutSession("ws_test" as never, {
        email: null,
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
      }),
    ).rejects.toThrow(/STRIPE_PRICE_ANCHOR is not configured/);
  });
});

describe("addModuleSubscriptionItem boundary", () => {
  afterEach(() => restoreEnv());

  it("throws a clear error when STRIPE_PRICE_MODULE_POS_0 is unset", async () => {
    delete process.env.STRIPE_PRICE_MODULE_POS_0;
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    const mod = await importWithMocks({
      subscription: { tier: "pro", stripeSubscriptionId: "sub_test", workspaceId: "ws_test" },
    });
    await expect(
      mod.addModuleSubscriptionItem("ws_test" as never, "invoices" as never),
    ).rejects.toThrow(/STRIPE_PRICE_MODULE_POS_0 is not configured/);
  });

  it("throws UpgradeRequiredError for a Free workspace", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    process.env.STRIPE_PRICE_MODULE_POS_0 = "price_test_m0";
    const mod = await importWithMocks({
      subscription: { tier: "free", stripeSubscriptionId: null, workspaceId: "ws_test" },
    });
    await expect(
      mod.addModuleSubscriptionItem("ws_test" as never, "invoices" as never),
    ).rejects.toThrow(/Upgrade to Pro to enable modules/);
  });

  it("throws a clear error for a legacy Pro workspace with no stripeSubscriptionId", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    process.env.STRIPE_PRICE_MODULE_POS_0 = "price_test_m0";
    const mod = await importWithMocks({
      subscription: { tier: "pro", stripeSubscriptionId: null, workspaceId: "ws_test" },
    });
    await expect(
      mod.addModuleSubscriptionItem("ws_test" as never, "invoices" as never),
    ).rejects.toThrow(/Re-upgrade via Stripe Checkout/);
  });
});

describe("ensureStripeCustomer boundary", () => {
  afterEach(() => restoreEnv());

  it("throws a clear error when STRIPE_SECRET_KEY is unset", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const mod = await importWithMocks({
      subscription: { stripeCustomerId: null, workspaceId: "ws_test" },
    });
    await expect(mod.ensureStripeCustomer("ws_test" as never, { email: null })).rejects.toThrow(
      /STRIPE_SECRET_KEY is not configured/,
    );
  });

  it("returns the stored customer id without calling Stripe when one exists", async () => {
    const mod = await importWithMocks({
      subscription: { stripeCustomerId: "cus_existing", workspaceId: "ws_test" },
    });
    const id = await mod.ensureStripeCustomer("ws_test" as never, { email: null });
    expect(id).toBe("cus_existing");
  });
});
