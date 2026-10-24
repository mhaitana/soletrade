// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { branded } from "@/shared/types/ids";
const b = vi.hoisted(() => ({
  authority: null as Record<string, unknown> | null,
  subscription: {} as Record<string, unknown>,
  stripe: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  refund: vi.fn(),
  grant: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
  due: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  getDataClient: () => ({
    rpc: b.rpc,
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        limit: () => builder,
        update: (payload: unknown) => {
          b.update(table, payload);
          return builder;
        },
        maybeSingle: async () => ({
          data:
            table === "billing_contracts"
              ? b.authority
              : table === "subscriptions"
                ? {
                    workspace_id: "11111111-1111-4111-8111-111111111111",
                    stripe_subscription_id: "sub_current",
                  }
                : null,
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [{ id: "test-subscription" }], error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));
vi.mock("@/platform/billing/subscriptions", () => ({
  getSubscription: async () => b.subscription,
  ensureSubscription: async () => b.subscription,
  setBillingInterval: vi.fn(),
}));
vi.mock("@/platform/module-installations", () => ({
  getInstalledModules: async () => ["books"],
  enableModule: b.enable,
  disableModule: b.disable,
  scheduleModuleCancellation: vi.fn(),
  listPendingCancellationsDue: b.due,
}));
vi.mock("@/platform/billing/credits", () => ({ refundCredit: b.refund, grantCredit: b.grant }));
vi.mock("@/server/stripe/prices", () => ({
  getModulePriceId: () => "price_books",
  priceSlot: () => "books_monthly",
  buildPriceIdToModuleMap: () => new Map(),
}));
vi.mock("@/server/stripe/client", () => ({ getStripe: b.stripe }));
vi.mock("@/server/events", () => ({ publishEvent: vi.fn() }));
vi.mock("@/platform/audit", () => ({ writeAudit: vi.fn() }));
import {
  createCheckoutSession,
  addModuleSubscriptionItem,
  removeModuleSubscriptionItem,
  cancelSubscription,
  refundToCard,
  switchSubscriptionInterval,
  cancelPendingCheckout,
} from "@/server/stripe/stripe-lifecycle";
import {
  reconcileSubscription,
  markCanceled,
  reconcileFromCheckoutSession,
  recordInvoicePaid,
} from "./reconcile";
import { finalizeModuleCancellations, removeModuleFromSubscription } from "./modules";
const workspace = branded<"WorkspaceId">("11111111-1111-4111-8111-111111111111");
const stripeEvent = (externalId = "sub_current") =>
  ({
    id: externalId,
    status: "canceled",
    metadata: { workspaceId: workspace },
    items: { data: [] },
  }) as unknown as Stripe.Subscription;
beforeEach(() => {
  vi.resetAllMocks();
  b.authority = {
    provider: "apple",
    external_id: "original-apple",
    status: "active",
    paid_through: "2099-01-01T00:00:00Z",
    grace_until: null,
    current: true,
  };
  b.subscription = {
    id: "test-subscription",
    workspaceId: workspace,
    stripeSubscriptionId: "sub_current",
    stripeCustomerId: "cus_current",
    billingInterval: "monthly",
    status: "active",
    anchorBillingDate: new Date("2026-10-01"),
  };
  b.rpc.mockResolvedValue({ data: true, error: null });
  b.due.mockResolvedValue([
    { workspaceId: workspace, moduleKey: "books", stripeSubscriptionItemId: "si_old" },
  ]);
});
describe("provider-aware Stripe boundaries", () => {
  it.each(["checkout", "add", "remove", "cancel", "refund", "switch"])(
    "rejects %s when a store owns billing before calling Stripe",
    async (action) => {
      const work =
        action === "checkout"
          ? () =>
              createCheckoutSession(workspace, {
                moduleKeys: ["books"],
                interval: "monthly",
                successUrl: "https://example.com/yes",
                cancelUrl: "https://example.com/no",
              })
          : action === "add"
            ? () => addModuleSubscriptionItem(workspace, "books")
            : action === "remove"
              ? () => removeModuleSubscriptionItem(workspace, "books")
              : action === "cancel"
                ? () => cancelSubscription(workspace)
                : action === "refund"
                  ? () => refundToCard(workspace, 100)
                  : () => switchSubscriptionInterval(workspace, "annual");
      await expect(work()).rejects.toThrow(/Apple|store|provider/i);
      expect(b.stripe).not.toHaveBeenCalled();
    },
  );
  it("does not apply late Stripe subscription updates over store coverage", async () => {
    await reconcileSubscription(stripeEvent());
    expect(b.update).not.toHaveBeenCalled();
    expect(b.rpc).not.toHaveBeenCalled();
  });
  it("does not refund credit or disable modules on late Stripe deletion", async () => {
    await markCanceled(stripeEvent());
    expect(b.refund).not.toHaveBeenCalled();
    expect(b.disable).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
  });
  it("does not restore old Stripe modules on late checkout completion", async () => {
    await reconcileFromCheckoutSession(
      {
        client_reference_id: workspace,
        subscription: "sub_old",
        customer: "cus_old",
      } as unknown as Stripe.Checkout.Session,
      {
        interval: "monthly",
        items: [{ moduleKey: "invoices", role: "standalone", itemId: "si_old" }],
      },
    );
    expect(b.enable).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
  });
  it("ignores old Stripe external IDs after a replacement Stripe subscription", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "sub_current",
      status: "active",
      current: true,
    };
    await reconcileSubscription(stripeEvent("sub_old"));
    await markCanceled(stripeEvent("sub_old"));
    expect(b.update).not.toHaveBeenCalled();
    expect(b.disable).not.toHaveBeenCalled();
    expect(b.refund).not.toHaveBeenCalled();
  });
  it("skips old scheduled module cancellations when a store now owns billing", async () => {
    expect(await finalizeModuleCancellations()).toBe(0);
    expect(b.disable).not.toHaveBeenCalled();
    expect(b.stripe).not.toHaveBeenCalled();
  });
  it("does not grant Stripe invoice credits to a store-owned workspace", async () => {
    await recordInvoicePaid({
      id: "in_old",
      customer: "cus_current",
      amount_paid: 1000,
      currency: "aud",
      parent: { subscription_details: { subscription: "sub_current" } },
    } as unknown as Stripe.Invoice);
    expect(b.grant).not.toHaveBeenCalled();
  });
  it("reserves billing authority before issuing a live Checkout session", async () => {
    b.authority = null;
    b.subscription.stripeSubscriptionId = null;
    b.stripe.mockReturnValue({ checkout: { sessions: { create: b.checkout } } });
    b.checkout.mockImplementation(async () => {
      expect(b.rpc.mock.calls.some((c) => c[0] === "mobile_reserve_stripe_checkout")).toBe(true);
      return { id: "cs_new", url: "https://checkout.example" };
    });
    await createCheckoutSession(workspace, {
      moduleKeys: ["books"],
      interval: "monthly",
      successUrl: "https://example.com/yes",
      cancelUrl: "https://example.com/no",
    });
    expect(b.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        expires_at: expect.any(Number),
        metadata: expect.objectContaining({ reservationId: expect.any(String) }),
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
  });
  it("does not open Checkout if another purchase already holds the workspace reservation", async () => {
    b.authority = null;
    b.subscription.stripeSubscriptionId = null;
    b.rpc.mockResolvedValue({ data: false, error: null });
    b.stripe.mockReturnValue({ checkout: { sessions: { create: b.checkout } } });
    await expect(
      createCheckoutSession(workspace, {
        moduleKeys: ["books"],
        interval: "monthly",
        successUrl: "https://example.com/yes",
        cancelUrl: "https://example.com/no",
      }),
    ).rejects.toThrow(/billing|purchase|coverage|checkout/i);
    expect(b.checkout).not.toHaveBeenCalled();
  });
  it("projects current Stripe contracts even when subscription status is unchanged", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "sub_current",
      status: "active",
      current: true,
    };
    await reconcileSubscription({ ...stripeEvent(), status: "active" } as Stripe.Subscription);
    expect(b.rpc).toHaveBeenCalledWith(
      "mobile_apply_stripe_contract",
      expect.objectContaining({
        p_workspace_id: workspace,
        p_external_id: "sub_current",
        p_status: "active",
      }),
    );
  });
  it("expires an open Stripe Checkout session before releasing the provider reservation", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "checkout:11111111-1111-4111-8111-111111111111",
      product_key: "cs_pending",
      status: "incomplete",
      paid_through: "2099-01-01T00:00:00Z",
      current: true,
    };
    const expire = vi.fn().mockResolvedValue({ status: "expired" });
    const retrieve = vi.fn().mockResolvedValue({
      id: "cs_pending",
      status: "open",
      subscription: null,
      client_reference_id: workspace,
      metadata: { reservationId: "11111111-1111-4111-8111-111111111111" },
    });
    b.stripe.mockReturnValue({ checkout: { sessions: { retrieve, expire } } });
    b.rpc.mockImplementation(async (name) => {
      if (name === "mobile_release_stripe_checkout")
        expect(expire).toHaveBeenCalledWith("cs_pending");
      return { data: true, error: null };
    });
    await expect(cancelPendingCheckout(workspace)).resolves.toBeUndefined();
    expect(b.rpc).toHaveBeenCalledWith("mobile_release_stripe_checkout", expect.anything());
  });
  it("cannot release a Checkout reservation once a subscription was purchased", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "checkout:11111111-1111-4111-8111-111111111111",
      product_key: "cs_pending",
      status: "incomplete",
      paid_through: "2099-01-01T00:00:00Z",
      current: true,
    };
    b.stripe.mockReturnValue({
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            status: "complete",
            subscription: "sub_new",
            client_reference_id: workspace,
            metadata: { reservationId: "11111111-1111-4111-8111-111111111111" },
          }),
        },
      },
    });
    await expect(cancelPendingCheckout(workspace)).rejects.toThrow(/completed|reconcil|purchased/i);
    expect(b.rpc).not.toHaveBeenCalled();
  });
  it("allows checkout after verified store coverage expires", async () => {
    b.authority = {
      provider: "google",
      external_id: "old-google",
      status: "expired",
      paid_through: "2020-01-01T00:00:00Z",
      grace_until: null,
    };
    b.subscription.stripeSubscriptionId = null;
    b.stripe.mockReturnValue({ checkout: { sessions: { create: b.checkout } } });
    b.checkout.mockResolvedValue({ id: "cs_after_store", url: "https://checkout.example" });
    await expect(
      createCheckoutSession(workspace, {
        moduleKeys: ["books"],
        interval: "monthly",
        successUrl: "https://example.com/yes",
        cancelUrl: "https://example.com/no",
      }),
    ).resolves.toMatchObject({ sessionId: "cs_after_store" });
  });
  it("blocks Google grace coverage even after the original paid date passed", async () => {
    b.authority = {
      provider: "google",
      external_id: "google",
      status: "grace",
      paid_through: "2020-01-01T00:00:00Z",
      grace_until: "2099-01-01T00:00:00Z",
    };
    await expect(
      createCheckoutSession(workspace, {
        moduleKeys: ["books"],
        interval: "monthly",
        successUrl: "https://example.com/yes",
        cancelUrl: "https://example.com/no",
      }),
    ).rejects.toThrow(/Google/);
    expect(b.stripe).not.toHaveBeenCalled();
  });
  it("rejects stale Stripe invoice external IDs after replacement", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "sub_current",
      status: "active",
      current: true,
    };
    await recordInvoicePaid({
      id: "in_old",
      customer: "cus_current",
      amount_paid: 1000,
      currency: "aud",
      parent: { subscription_details: { subscription: "sub_old" } },
    } as unknown as Stripe.Invoice);
    expect(b.grant).not.toHaveBeenCalled();
  });
  it("honors a failed atomic authority claim without changing local billing", async () => {
    b.authority = null;
    b.rpc.mockResolvedValue({ data: false, error: null });
    await expect(
      reconcileFromCheckoutSession(
        {
          client_reference_id: workspace,
          subscription: "sub_current",
          customer: "cus_current",
        } as unknown as Stripe.Checkout.Session,
        {
          interval: "monthly",
          items: [{ moduleKey: "books", role: "standalone", itemId: "si_books" }],
        },
      ),
    ).resolves.toBe(false);
    expect(b.enable).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
  });
  it("ends Stripe coverage at the actual cancellation time so a provider can change afterwards", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "sub_current",
      status: "active",
      current: true,
    };
    await markCanceled({
      ...stripeEvent(),
      ended_at: 1_790_000_000,
      items: { data: [{ current_period_end: 1_800_000_000 }] },
    } as unknown as Stripe.Subscription);
    expect(b.rpc).toHaveBeenCalledWith(
      "mobile_apply_stripe_contract",
      expect.objectContaining({
        p_status: "canceled",
        p_paid_through: new Date(1_790_000_000 * 1000).toISOString(),
      }),
    );
  });
  it("does not disable a module if authority changes while its Stripe item is being removed", async () => {
    b.authority = {
      provider: "stripe",
      external_id: "sub_current",
      status: "active",
      id: "stripe-contract",
      current: true,
    };
    b.rpc.mockResolvedValue({ data: false, error: null });
    await expect(removeModuleFromSubscription(workspace, "books", undefined)).rejects.toThrow(
      /provider|billing|authority/i,
    );
    expect(b.disable).not.toHaveBeenCalled();
  });
});
