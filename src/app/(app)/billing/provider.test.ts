// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const b = vi.hoisted(() => ({
  checkout: vi.fn(),
  credit: vi.fn(),
  ledger: vi.fn(),
  authority: {
    provider: "apple",
    status: "active",
    paid_through: "2099-01-01T00:00:00Z",
    grace_until: null,
    external_id: "apple-original",
    current: true,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/context", () => ({
  requireWorkspaceContext: async () => ({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    user: { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com" },
    role: "owner",
  }),
}));
vi.mock("@/server/security", () => ({ authorizeOrAudit: async () => ({ ok: true }) }));
vi.mock("@/platform/billing", () => ({
  ensureSubscription: async () => ({
    billingInterval: "monthly",
    stripeSubscriptionId: "sub_stale",
    status: "active",
    anchorBillingDate: new Date(),
  }),
  getCreditBalance: b.credit,
  listCreditLedger: b.ledger,
  priceSubscription: () => ({ currency: "AUD", interval: "monthly", modules: [], totalCents: 0 }),
  cancelSubscription: vi.fn(),
  switchBillingInterval: vi.fn(),
  getCancellationOptions: vi.fn(),
  BillingNotStartedError: class extends Error {},
}));
vi.mock("@/platform/module-installations", () => ({ getInstalledModules: async () => ["books"] }));
vi.mock("@/server/stripe/stripe-lifecycle", () => ({ createCheckoutSession: b.checkout }));
vi.mock("@/platform/billing/promotions", () => ({ resolveCheckoutPromotion: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  getDataClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: b.authority, error: null }),
      };
      return q;
    },
  }),
}));
import { loadBillingOverview, startBillingCheckoutAction } from "./actions";
beforeEach(() => {
  vi.clearAllMocks();
  b.credit.mockResolvedValue(500);
  b.ledger.mockResolvedValue([]);
  b.checkout.mockResolvedValue({ url: "https://checkout.example" });
});
it("loads the store provider and paid-through state without presenting Stripe credits", async () => {
  const data = await loadBillingOverview();
  expect(data).toMatchObject({
    provider: "apple",
    paidThrough: "2099-01-01T00:00:00Z",
    status: "active",
  });
  expect(b.credit).not.toHaveBeenCalled();
  expect(b.ledger).not.toHaveBeenCalled();
});
it("rejects a web checkout action before invoking Stripe while store billing owns coverage", async () => {
  expect(
    await startBillingCheckoutAction({ moduleKeys: ["books"], interval: "monthly" }),
  ).toMatchObject({ ok: false, error: expect.stringMatching(/Apple/) });
  expect(b.checkout).not.toHaveBeenCalled();
});
