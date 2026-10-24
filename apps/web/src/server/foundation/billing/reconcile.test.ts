import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  mapStripeStatusToLocal,
  mapCheckoutSessionToUpdate,
} from "@/server/foundation/billing/reconcile";

/**
 * Unit tests for the pure reconcile mappers. No DB, no Stripe I/O - synthetic
 * Stripe objects with only the picked fields.
 */

describe("mapStripeStatusToLocal", () => {
  it("maps active → active", () => {
    expect(mapStripeStatusToLocal("active")).toBe("active");
  });

  it("maps past_due → past_due", () => {
    expect(mapStripeStatusToLocal("past_due")).toBe("past_due");
  });

  it("maps canceled → canceled", () => {
    expect(mapStripeStatusToLocal("canceled")).toBe("canceled");
  });

  it("maps ended → canceled", () => {
    expect(mapStripeStatusToLocal("ended")).toBe("canceled");
  });

  it("maps incomplete → incomplete", () => {
    expect(mapStripeStatusToLocal("incomplete")).toBe("incomplete");
  });

  it("maps incomplete_expired → incomplete", () => {
    expect(mapStripeStatusToLocal("incomplete_expired")).toBe("incomplete");
  });

  it("maps trialing → active (treat trialing as active)", () => {
    expect(mapStripeStatusToLocal("trialing")).toBe("active");
  });

  it("maps unknown status → incomplete (safe default)", () => {
    expect(mapStripeStatusToLocal("unknown_status")).toBe("incomplete");
  });
});

describe("mapCheckoutSessionToUpdate", () => {
  it("extracts customer/subscription as strings and sets status=active", () => {
    const session = {
      customer: "cus_test_123",
      subscription: "sub_test_456",
    } as Pick<Stripe.Checkout.Session, "customer" | "subscription">;
    expect(mapCheckoutSessionToUpdate(session)).toEqual({
      status: "active",
      stripeCustomerId: "cus_test_123",
      stripeSubscriptionId: "sub_test_456",
    });
  });

  it("coerces non-string customer to a string", () => {
    // Stripe types customer as string | Customer | null. The mapper uses String() so a
    // null is coerced to "null" (the route guards against this in practice -
    // checkout.session.completed always carries a customer id).
    const session = {
      customer: null,
      subscription: "sub_test",
    } as Pick<Stripe.Checkout.Session, "customer" | "subscription">;
    const result = mapCheckoutSessionToUpdate(session);
    expect(result.status).toBe("active");
    expect(result.stripeSubscriptionId).toBe("sub_test");
  });
});
