import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Boundary tests for the Stripe lifecycle service. No network, no DB.
 *
 * Asserts the env-boundary + state-boundary errors surface clearly when Stripe/price
 * secrets are unset or billing hasn't started. To test the unset path we set/unset
 * process.env, register `vi.doMock` for the DB-touching deps, `vi.resetModules()`, then
 * dynamic-import — the order matters: mocks must be registered before the module
 * resolves its imports.
 */

const ORIGINAL = {
  SECRET: process.env.STRIPE_SECRET_KEY,
  BOOKS_STANDALONE_MONTHLY: process.env.STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY,
  INVOICES_ADDON_MONTHLY: process.env.STRIPE_PRICE_INVOICES_ADDON_MONTHLY,
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

function setPriceIds() {
  process.env.STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY = "price_books_st_m";
  process.env.STRIPE_PRICE_BOOKS_STANDALONE_ANNUAL = "price_books_st_a";
  process.env.STRIPE_PRICE_BOOKS_ADDON_MONTHLY = "price_books_ad_m";
  process.env.STRIPE_PRICE_BOOKS_ADDON_ANNUAL = "price_books_ad_a";
  process.env.STRIPE_PRICE_QUOTES_STANDALONE_MONTHLY = "price_quotes_st_m";
  process.env.STRIPE_PRICE_QUOTES_STANDALONE_ANNUAL = "price_quotes_st_a";
  process.env.STRIPE_PRICE_QUOTES_ADDON_MONTHLY = "price_quotes_ad_m";
  process.env.STRIPE_PRICE_QUOTES_ADDON_ANNUAL = "price_quotes_ad_a";
  process.env.STRIPE_PRICE_DRIVE_STANDALONE_MONTHLY = "price_drive_st_m";
  process.env.STRIPE_PRICE_DRIVE_STANDALONE_ANNUAL = "price_drive_st_a";
  process.env.STRIPE_PRICE_DRIVE_ADDON_MONTHLY = "price_drive_ad_m";
  process.env.STRIPE_PRICE_DRIVE_ADDON_ANNUAL = "price_drive_ad_a";
  process.env.STRIPE_PRICE_INVOICES_STANDALONE_MONTHLY = "price_invoices_st_m";
  process.env.STRIPE_PRICE_INVOICES_STANDALONE_ANNUAL = "price_invoices_st_a";
  process.env.STRIPE_PRICE_INVOICES_ADDON_MONTHLY = "price_invoices_ad_m";
  process.env.STRIPE_PRICE_INVOICES_ADDON_ANNUAL = "price_invoices_ad_a";
}

describe("createCheckoutSession boundary", () => {
  afterEach(() => restoreEnv());

  it("throws a clear error when the anchor module's standalone price env is unset", async () => {
    delete process.env.STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY;
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    setPriceIds(); // re-set everything
    delete process.env.STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY; // then remove the anchor one
    const mod = await importWithMocks({ subscription: { workspaceId: "ws_test" } });
    await expect(
      mod.createCheckoutSession("ws_test" as never, {
        moduleKeys: ["books", "invoices"],
        interval: "monthly",
        email: null,
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
      }),
    ).rejects.toThrow(/STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY is not configured/);
  });

  it("throws when called with an empty module set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    setPriceIds();
    const mod = await importWithMocks({ subscription: { workspaceId: "ws_test" } });
    await expect(
      mod.createCheckoutSession("ws_test" as never, {
        moduleKeys: [],
        interval: "monthly",
        email: null,
        successUrl: "https://example.com/s",
        cancelUrl: "https://example.com/c",
      }),
    ).rejects.toThrow(/no modules selected/);
  });
});

describe("addModuleSubscriptionItem boundary", () => {
  afterEach(() => restoreEnv());

  it("throws BillingNotStartedError when no Stripe subscription exists", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    setPriceIds();
    const mod = await importWithMocks({
      subscription: {
        billingInterval: null,
        stripeSubscriptionId: null,
        status: "active",
        workspaceId: "ws_test",
      },
      installedModules: ["invoices"],
    });
    await expect(
      mod.addModuleSubscriptionItem("ws_test" as never, "books" as never),
    ).rejects.toThrow(/Start billing to enable modules/);
  });

  it("throws BillingNotStartedError when the subscription status is not active", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    setPriceIds();
    const mod = await importWithMocks({
      subscription: {
        billingInterval: "monthly",
        stripeSubscriptionId: "sub_test",
        status: "canceled",
        workspaceId: "ws_test",
      },
      installedModules: ["invoices"],
    });
    await expect(
      mod.addModuleSubscriptionItem("ws_test" as never, "books" as never),
    ).rejects.toThrow(/Start billing to enable modules/);
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

describe("cancelSubscription boundary", () => {
  afterEach(() => restoreEnv());

  it("throws BillingNotStartedError when no Stripe subscription exists", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    const mod = await importWithMocks({
      subscription: {
        billingInterval: null,
        stripeSubscriptionId: null,
        status: "active",
        workspaceId: "ws_test",
      },
    });
    await expect(mod.cancelSubscription("ws_test" as never)).rejects.toThrow(
      /Start billing to enable modules/,
    );
  });

  it("throws BillingNotStartedError when the subscription status is not active", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    const mod = await importWithMocks({
      subscription: {
        billingInterval: "monthly",
        stripeSubscriptionId: "sub_test",
        status: "canceled",
        workspaceId: "ws_test",
      },
    });
    await expect(mod.cancelSubscription("ws_test" as never)).rejects.toThrow(
      /Start billing to enable modules/,
    );
  });
});

describe("switchSubscriptionInterval boundary", () => {
  afterEach(() => restoreEnv());

  it("throws BillingNotStartedError when no active Stripe subscription exists", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    setPriceIds();
    const mod = await importWithMocks({
      subscription: {
        billingInterval: null,
        stripeSubscriptionId: null,
        status: "active",
        workspaceId: "ws_test",
      },
      installedModules: ["books"],
    });
    await expect(
      mod.switchSubscriptionInterval("ws_test" as never, "annual" as never),
    ).rejects.toThrow(/Start billing to enable modules/);
  });

  it("throws BillingNotStartedError when the subscription status is canceled", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_boundary";
    setPriceIds();
    const mod = await importWithMocks({
      subscription: {
        billingInterval: "monthly",
        stripeSubscriptionId: "sub_test",
        status: "canceled",
        workspaceId: "ws_test",
      },
      installedModules: ["books"],
    });
    await expect(
      mod.switchSubscriptionInterval("ws_test" as never, "annual" as never),
    ).rejects.toThrow(/Start billing to enable modules/);
  });
});
