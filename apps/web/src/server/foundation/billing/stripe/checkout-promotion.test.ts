vi.mock("@/server/foundation/billing/authority", () => ({
  assertStripeAuthority: vi.fn().mockResolvedValue(null),
  reserveStripeCheckout: vi.fn().mockResolvedValue({
    reservationId: "11111111-1111-4111-8111-111111111111",
    expiresAt: 2000000000,
  }),
  releaseStripeCheckout: vi.fn(),
  recordStripeCheckoutSession: vi.fn(),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkoutCreate } = vi.hoisted(() => ({
  checkoutCreate: vi.fn(),
}));

vi.mock("@/server/infrastructure/stripe/client", () => ({
  getStripe: () => ({ checkout: { sessions: { create: checkoutCreate } } }),
}));

vi.mock("@/server/foundation/billing/subscriptions", () => ({
  ensureSubscription: vi.fn().mockResolvedValue({ workspaceId: "ws_test" }),
  getSubscription: vi.fn().mockResolvedValue({
    workspaceId: "ws_test",
    stripeCustomerId: "cus_existing",
  }),
}));

vi.mock("@/server/foundation/module-installations", () => ({
  getInstalledModules: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: vi.fn(),
}));

vi.mock("@/server/infrastructure/config/env", () => ({
  env: {
    STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY: "price_books_standalone_monthly",
    STRIPE_PRICE_INVOICES_ADDON_MONTHLY: "price_invoices_addon_monthly",
  },
}));

import { createCheckoutSession } from "@/server/foundation/billing/stripe/stripe-lifecycle";

describe("linked checkout promotion", () => {
  beforeEach(() => {
    checkoutCreate.mockReset();
    checkoutCreate.mockResolvedValue({
      id: "cs_test",
      url: "https://checkout.stripe.test/session",
    });
  });

  it("pre-applies the linked promotion and carries its id into webhook metadata", async () => {
    await createCheckoutSession("ws_test" as never, {
      moduleKeys: ["books", "invoices"],
      interval: "monthly",
      email: "owner@example.com",
      successUrl: "https://example.com/billing?success=1",
      cancelUrl: "https://example.com/billing",
      allowPromotionCodes: true,
      promotion: {
        id: "promotion-1",
        stripePromotionCodeId: "promo_stripe_1",
        code: "LAUNCH25",
        discountType: "percentage",
        percentOff: 25,
        currency: "AUD",
        duration: "once",
        newCustomersOnly: true,
      },
    });

    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_existing",
        discounts: [{ promotion_code: "promo_stripe_1" }],
        metadata: { reservationId: expect.any(String), promotionId: "promotion-1" },
        subscription_data: {
          metadata: {
            workspaceId: "ws_test",
            interval: "monthly",
            reservationId: expect.any(String),
            promotionId: "promotion-1",
          },
        },
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(checkoutCreate.mock.calls[0]?.[0]).not.toHaveProperty("allow_promotion_codes");
  });

  it("keeps Stripe's manual promotion field when no link is attached", async () => {
    await createCheckoutSession("ws_test" as never, {
      moduleKeys: ["books"],
      interval: "monthly",
      successUrl: "https://example.com/billing?success=1",
      cancelUrl: "https://example.com/billing",
      allowPromotionCodes: true,
    });

    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ allow_promotion_codes: true }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(checkoutCreate.mock.calls[0]?.[0]).not.toHaveProperty("discounts");
  });
});
