import { beforeEach, describe, expect, it, vi } from "vitest";
import { branded } from "@/types/ids";

const mocks = vi.hoisted(() => ({ contract: vi.fn(), subscription: vi.fn() }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: mocks.contract,
      };
      return query;
    },
  }),
}));
vi.mock("@/server/foundation/billing/subscriptions", () => ({
  getSubscription: mocks.subscription,
}));
import { getBillingState } from "./state";

beforeEach(() => vi.clearAllMocks());

describe("provider-neutral billing state", () => {
  it("retains store grace coverage and pending changes for receipt entitlement and mobile clients", async () => {
    mocks.contract.mockResolvedValue({
      error: null,
      data: {
        provider: "apple",
        status: "grace",
        paid_through: "2026-10-20T00:00:00Z",
        grace_until: "2026-10-27T00:00:00Z",
        interval: "monthly",
        renews: true,
        pending_modules: ["books"],
        pending_interval: "annual",
      },
    });
    await expect(getBillingState(branded<"WorkspaceId">("workspace"))).resolves.toEqual({
      provider: "apple",
      status: "grace",
      paidThrough: "2026-10-27T00:00:00Z",
      interval: "monthly",
      renews: true,
      pendingModules: ["books"],
      pendingInterval: "annual",
    });
    expect(mocks.subscription).not.toHaveBeenCalled();
  });

  it("preserves legacy Stripe subscription fallback when no authority contract exists", async () => {
    mocks.contract.mockResolvedValue({ error: null, data: null });
    mocks.subscription.mockResolvedValue({
      stripeSubscriptionId: "sub_legacy",
      status: "active",
      billingInterval: "annual",
    });
    await expect(getBillingState(branded<"WorkspaceId">("workspace"))).resolves.toEqual({
      provider: "stripe",
      status: "active",
      paidThrough: null,
      interval: "annual",
      pendingModules: null,
      pendingInterval: null,
    });
  });
});
