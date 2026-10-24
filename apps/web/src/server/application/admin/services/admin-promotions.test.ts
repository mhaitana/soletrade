import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the admin promotions Stripe integration. No network, no DB.
 *
 * Pattern mirrors `stripe-lifecycle.test.ts`: `vi.resetModules()` + `vi.doMock` for the
 * Stripe client, admin-auth, audit, and the admin DB accessor before dynamic-import, so
 * the boundary-asserting `getStripe()` is bypassed and `.coupons.create` etc. can be
 * `vi.fn()`'d. The DB client is a tiny chainable fake that captures inserts/updates.
 */

const ORIGINAL_SECRET = process.env.STRIPE_SECRET_KEY;

function restoreEnv() {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_SECRET;
}

/** Build a Stripe client mock with vi.fn stubs for the coupon/promotion-code methods. */
function makeStripeMock() {
  const couponsCreate = vi
    .fn()
    .mockResolvedValue({ id: "coupon_x", valid: true, times_redeemed: 0 });
  const couponsRetrieve = vi
    .fn()
    .mockResolvedValue({ id: "coupon_x", valid: true, times_redeemed: 3 });
  const couponsUpdate = vi.fn().mockResolvedValue({ id: "coupon_x", valid: false });
  const couponsDel = vi.fn().mockResolvedValue({ id: "coupon_x", deleted: true });
  const promoCreate = vi.fn().mockResolvedValue({ id: "promo_x", active: true, times_redeemed: 2 });
  const promoRetrieve = vi
    .fn()
    .mockResolvedValue({ id: "promo_x", active: true, times_redeemed: 2 });
  const promoUpdate = vi.fn().mockResolvedValue({ id: "promo_x", active: false });
  return {
    stripe: {
      coupons: {
        create: couponsCreate,
        retrieve: couponsRetrieve,
        update: couponsUpdate,
        del: couponsDel,
      },
      promotionCodes: { create: promoCreate, retrieve: promoRetrieve, update: promoUpdate },
    },
    couponsCreate,
    couponsRetrieve,
    couponsUpdate,
    couponsDel,
    promoCreate,
    promoRetrieve,
    promoUpdate,
  };
}

/** Minimal chainable fake of the Supabase admin client — just enough for the service's
 *  `.from("promotions").insert(...).select().single()`, `...select().eq().limit().maybeSingle()`,
 *  and `...update(...).eq(...)` call shapes. */
function makeDbMock() {
  const inserted: unknown[] = [];
  const updated: { id: string; patch: Record<string, unknown> }[] = [];
  let nextRow: Record<string, unknown> = {
    id: "promo_local_1",
    name: "Test",
    stripe_coupon_id: "coupon_x",
    stripe_promotion_code_id: "promo_x",
  };
  function chain() {
    let op: "insert" | "update" | "select" | null = null;
    let payload: Record<string, unknown> | null = null;
    const c: Record<string, unknown> = {
      insert: (obj: Record<string, unknown>) => {
        op = "insert";
        payload = obj;
        inserted.push(obj);
        return c;
      },
      update: (obj: Record<string, unknown>) => {
        op = "update";
        payload = obj;
        return c;
      },
      select: () => {
        op = "select";
        return c;
      },
      eq: (_col: string, val: unknown) => {
        if (op === "update") updated.push({ id: String(val), patch: payload ?? {} });
        return c;
      },
      limit: () => c,
      order: () => c,
      single: () =>
        Promise.resolve({ data: { ...(payload ?? nextRow), id: "promo_local_1" }, error: null }),
      maybeSingle: () => Promise.resolve({ data: nextRow, error: null }),
      // Await without a terminal single/maybeSingle (update path) → resolves void-ish.
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return c;
  }
  return {
    db: { from: () => chain() },
    inserted,
    updated,
    setNextRow: (r: Record<string, unknown>) => {
      nextRow = r;
    },
  };
}

async function importWithMocks() {
  vi.resetModules();
  const { stripe, ...fns } = makeStripeMock();
  const { db, ...dbState } = makeDbMock();
  vi.doMock("@/server/infrastructure/stripe/client", () => ({ getStripe: () => stripe }));
  vi.doMock("@/server/application/auth/admin-context", () => ({
    requireAdminContext: vi
      .fn()
      .mockResolvedValue({ adminUser: { id: "admin_1" }, roles: ["billing_admin"] }),
  }));
  vi.doMock("@/server/application/admin/services/admin-audit", () => ({
    writeAdminAuditEvent: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("@/server/foundation/identity/db", () => ({ getAdminDb: () => db }));
  // listPromotions is called at the tail of createPromotion; it re-reads via the same
  // db mock (maybeSingle returns nextRow). That's fine for returning a found row.
  const mod =
    (await import("@/server/application/admin/services/admin-promotions")) as typeof import("@/server/application/admin/services/admin-promotions");
  return { mod, ...fns, ...dbState };
}

describe("createPromotion", () => {
  afterEach(() => {
    vi.doUnmock("@/server/infrastructure/stripe/client");
    vi.doUnmock("@/server/application/auth/admin-context");
    vi.doUnmock("@/server/application/admin/services/admin-audit");
    vi.doUnmock("@/server/foundation/identity/db");
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("creates a Stripe coupon with percent_off for a percentage discount and stores its id", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, couponsCreate, promoCreate, inserted } = await importWithMocks();
    await mod.createPromotion({
      name: "Summer",
      discountType: "percentage",
      percentOff: 25,
      currency: "AUD",
      duration: "once",
      reason: "Summer launch",
    });
    expect(couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ percent_off: 25, duration: "once" }),
    );
    expect(couponsCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ amount_off: expect.anything() }),
    );
    expect(promoCreate).not.toHaveBeenCalled();
    expect(inserted[0]).toMatchObject({
      stripe_coupon_id: "coupon_x",
      stripe_promotion_code_id: null,
    });
  });

  it("creates a fixed-amount coupon with amount_off + currency", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, couponsCreate } = await importWithMocks();
    await mod.createPromotion({
      name: "Flat",
      discountType: "fixed_amount",
      amountOffCents: 2500,
      currency: "NZD",
      duration: "forever",
      reason: "Flat discount launch",
    });
    expect(couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount_off: 2500, currency: "nzd", duration: "forever" }),
    );
  });

  it("passes duration_in_months only for repeating duration", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, couponsCreate } = await importWithMocks();
    await mod.createPromotion({
      name: "3mo",
      discountType: "percentage",
      percentOff: 10,
      duration: "repeating",
      durationInMonths: 3,
      reason: "Repeating discount",
    });
    expect(couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ duration: "repeating", duration_in_months: 3 }),
    );
  });

  it("creates a promotion code with the public code + first_time_subscribers restriction when newCustomersOnly", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, couponsCreate, promoCreate, inserted } = await importWithMocks();
    await mod.createPromotion({
      name: "New cust",
      publicCode: "SUMMER25",
      discountType: "percentage",
      percentOff: 25,
      duration: "once",
      maxRedemptions: 100,
      newCustomersOnly: true,
      reason: "New customers only",
    });
    expect(couponsCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ max_redemptions: expect.anything() }),
    );
    expect(promoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: { coupon: "coupon_x", type: "coupon" },
        code: "SUMMER25",
        max_redemptions: 100,
        restrictions: { first_time_transaction: true },
      }),
    );
    expect(inserted[0]).toMatchObject({
      stripe_coupon_id: "coupon_x",
      stripe_promotion_code_id: "promo_x",
    });
  });

  it("cleans up the Stripe coupon if promotion-code creation throws (no orphans)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, couponsCreate, couponsDel, promoCreate } = await importWithMocks();
    promoCreate.mockRejectedValueOnce(new Error("code taken"));
    await expect(
      mod.createPromotion({
        name: "Orphan",
        publicCode: "TAKEN",
        discountType: "percentage",
        percentOff: 25,
        duration: "once",
        reason: "Orphan cleanup",
      }),
    ).rejects.toThrow(/code taken/);
    expect(couponsCreate).toHaveBeenCalled();
    expect(couponsDel).toHaveBeenCalledWith("coupon_x");
  });

  it("throws a clear STRIPE_SECRET_KEY error when Stripe is not configured (no mock)", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    vi.resetModules();
    vi.doMock("@/server/application/auth/admin-context", () => ({
      requireAdminContext: vi
        .fn()
        .mockResolvedValue({ adminUser: { id: "admin_1" }, roles: ["billing_admin"] }),
    }));
    vi.doMock("@/server/application/admin/services/admin-audit", () => ({
      writeAdminAuditEvent: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("@/server/foundation/identity/db", () => ({ getAdminDb: () => makeDbMock().db }));
    const mod =
      (await import("@/server/application/admin/services/admin-promotions")) as typeof import("@/server/application/admin/services/admin-promotions");
    await expect(
      mod.createPromotion({
        name: "No key",
        discountType: "percentage",
        percentOff: 25,
        duration: "once",
        reason: "No stripe key",
      }),
    ).rejects.toThrow(/STRIPE_SECRET_KEY/);
  });
});

describe("syncPromotionFromStripe", () => {
  afterEach(() => {
    vi.doUnmock("@/server/infrastructure/stripe/client");
    vi.doUnmock("@/server/application/auth/admin-context");
    vi.doUnmock("@/server/application/admin/services/admin-audit");
    vi.doUnmock("@/server/foundation/identity/db");
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("prefers the promotion code's redemption count and writes it + last_synced_at locally", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, couponsRetrieve, promoRetrieve, updated } = await importWithMocks();
    await mod.syncPromotionFromStripe("promo_local_1");
    expect(couponsRetrieve).toHaveBeenCalledWith("coupon_x");
    expect(promoRetrieve).toHaveBeenCalledWith("promo_x");
    expect(updated[0]).toMatchObject({
      id: "promo_local_1",
      patch: expect.objectContaining({
        times_redeemed: 2,
        stripe_coupon_active: true,
        last_synced_at: expect.any(String),
      }),
    });
  });
});

describe("archivePromotion", () => {
  afterEach(() => {
    vi.doUnmock("@/server/infrastructure/stripe/client");
    vi.doUnmock("@/server/application/auth/admin-context");
    vi.doUnmock("@/server/application/admin/services/admin-audit");
    vi.doUnmock("@/server/foundation/identity/db");
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("deactivates the promotion code + deletes the coupon on Stripe and sets local active=false", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const { mod, promoUpdate, couponsDel, updated } = await importWithMocks();
    await mod.archivePromotion("promo_local_1", "Campaign ended");
    expect(promoUpdate).toHaveBeenCalledWith("promo_x", { active: false });
    expect(couponsDel).toHaveBeenCalledWith("coupon_x");
    expect(updated[0]).toMatchObject({
      id: "promo_local_1",
      patch: expect.objectContaining({ active: false, stripe_coupon_active: false }),
    });
  });
});
