import "server-only";
import { getAdminDb } from "@/server/foundation/identity/db";
import { getStripe } from "@/server/infrastructure/stripe/client";
import type { Stripe } from "stripe";
import type { Promotion, PromotionDiscountType, PromotionDuration } from "@/lib/domain/admin/types";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { writeAdminAuditEvent } from "@/server/application/admin/services/admin-audit";

export async function listPromotions(): Promise<Promotion[]> {
  await requireAdminContext("view:subscriptions");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("promotions")
    .select("*")
    .order("created_at", { ascending: false });

  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      name: string;
      internal_description?: string;
      public_code?: string;
      stripe_coupon_id: string;
      stripe_promotion_code_id?: string | null;
      discount_type: PromotionDiscountType;
      percent_off?: number;
      amount_off_cents?: number;
      currency?: string;
      duration: PromotionDuration;
      duration_in_months?: number;
      max_redemptions?: number;
      redeem_by?: string;
      new_customers_only: boolean;
      active: boolean;
      times_redeemed: number;
      stripe_coupon_active?: boolean | null;
      stripe_promotion_code_active?: boolean | null;
      last_synced_at?: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    internalDescription: row.internal_description,
    publicCode: row.public_code,
    stripeCouponId: row.stripe_coupon_id,
    stripePromotionCodeId: row.stripe_promotion_code_id ?? undefined,
    discountType: row.discount_type,
    percentOff: row.percent_off,
    amountOffCents: row.amount_off_cents,
    currency: row.currency,
    duration: row.duration,
    durationInMonths: row.duration_in_months,
    maxRedemptions: row.max_redemptions,
    redeemBy: row.redeem_by ? new Date(row.redeem_by) : undefined,
    newCustomersOnly: row.new_customers_only,
    active: row.active,
    timesRedeemed: row.times_redeemed,
    stripeCouponActive: row.stripe_coupon_active ?? true,
    stripePromotionCodeActive: row.stripe_promotion_code_active ?? null,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : undefined,
  }));
}

export interface CreatePromotionParams {
  name: string;
  internalDescription?: string;
  publicCode?: string;
  currency?: string;
  discountType: PromotionDiscountType;
  percentOff?: number;
  amountOffCents?: number;
  duration: PromotionDuration;
  durationInMonths?: number;
  maxRedemptions?: number;
  newCustomersOnly?: boolean;
  reason: string;
}

/** Build the Stripe `coupon.create` payload from validated params. The coupon carries
 *  the discount + duration; `max_redemptions` lives on the coupon only when there's no
 *  public code (otherwise the promotion code gates redemption). */
function buildCouponParams(params: CreatePromotionParams): Stripe.CouponCreateParams {
  const coupon: Stripe.CouponCreateParams = {
    duration: params.duration,
  };
  if (params.discountType === "percentage") {
    coupon.percent_off = params.percentOff;
  } else {
    coupon.amount_off = params.amountOffCents;
    coupon.currency = (params.currency ?? "AUD").toLowerCase();
  }
  if (params.duration === "repeating" && params.durationInMonths != null) {
    coupon.duration_in_months = params.durationInMonths;
  }
  if (params.maxRedemptions != null && !params.publicCode) {
    coupon.max_redemptions = params.maxRedemptions;
  }
  return coupon;
}

export async function createPromotion(params: CreatePromotionParams): Promise<Promotion> {
  const ctx = await requireAdminContext("manage:promotions");
  if (!params.reason || params.reason.trim().length < 3) {
    throw new Error("A reason is required to create a promotion.");
  }
  if (
    params.discountType === "percentage" &&
    (params.percentOff == null || params.percentOff <= 0)
  ) {
    throw new Error("percentOff is required for a percentage discount.");
  }
  if (
    params.discountType === "fixed_amount" &&
    (params.amountOffCents == null || params.amountOffCents <= 0)
  ) {
    throw new Error("amountOffCents is required for a fixed-amount discount.");
  }

  const stripe = getStripe();
  const coupon = await stripe.coupons.create(buildCouponParams(params));

  // If a public code is requested, create a customer-shareable promotion code backed by
  // the coupon. If this fails after the coupon was created, delete the coupon so we
  // don't leave an orphaned discount in Stripe.
  let promotionCodeId: string | undefined;
  if (params.publicCode) {
    try {
      const promoCode = await stripe.promotionCodes.create({
        promotion: { coupon: coupon.id, type: "coupon" },
        code: params.publicCode,
        max_redemptions: params.maxRedemptions,
        restrictions: { first_time_transaction: params.newCustomersOnly ?? false },
      });
      promotionCodeId = promoCode.id;
    } catch (err) {
      try {
        await stripe.coupons.del(coupon.id);
      } catch {
        // best-effort cleanup; surface the original promotion-code failure
      }
      throw err;
    }
  }

  const db = getAdminDb();
  const { data, error } = await db
    .from("promotions")
    .insert({
      name: params.name,
      internal_description: params.internalDescription ?? null,
      public_code: params.publicCode ?? null,
      stripe_coupon_id: coupon.id,
      stripe_promotion_code_id: promotionCodeId ?? null,
      discount_type: params.discountType,
      percent_off: params.percentOff ?? null,
      amount_off_cents: params.amountOffCents ?? null,
      currency: params.currency ?? "AUD",
      duration: params.duration,
      duration_in_months: params.durationInMonths ?? null,
      max_redemptions: params.maxRedemptions ?? null,
      new_customers_only: params.newCustomersOnly ?? false,
      active: true,
      stripe_coupon_active: true,
      stripe_promotion_code_active: promotionCodeId ? true : null,
      created_by_admin_id: ctx.adminUser.id,
    })
    .select()
    .single();

  if (error || !data) {
    // Local insert failed after Stripe objects exist — best-effort clean up Stripe side.
    try {
      if (promotionCodeId) await stripe.promotionCodes.update(promotionCodeId, { active: false });
      await stripe.coupons.del(coupon.id);
    } catch {
      // surface the original DB failure
    }
    throw new Error(`Failed to create promotion: ${error?.message}`);
  }

  const createdId = (data as { id: string }).id;

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "billing_admin",
    action: "create_promotion",
    targetType: "promotion",
    targetId: createdId,
    reason: params.reason,
    metadata: {
      name: params.name,
      stripeCouponId: coupon.id,
      stripePromotionCodeId: promotionCodeId ?? null,
      publicCode: params.publicCode ?? null,
    },
  });

  const list = await listPromotions();
  return list.find((p) => p.id === createdId)!;
}

/** Pull live redemption counts + validity from Stripe into the local row. Idempotent. */
export async function syncPromotionFromStripe(promotionId: string): Promise<void> {
  const ctx = await requireAdminContext("manage:promotions");
  const db = getAdminDb();

  const { data, error } = await db
    .from("promotions")
    .select("id, name, stripe_coupon_id, stripe_promotion_code_id")
    .eq("id", promotionId)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Promotion not found.");
  }
  const row = data as {
    id: string;
    name: string;
    stripe_coupon_id: string;
    stripe_promotion_code_id?: string | null;
  };

  const stripe = getStripe();

  // The coupon may have been deleted by `archivePromotion` (the Stripe-blessed way to
  // deactivate a coupon is deletion — there is no `valid` update). Treat a missing
  // coupon as inactive rather than failing the whole sync.
  let couponValid = true;
  let couponTimesRedeemed = 0;
  try {
    const coupon = await stripe.coupons.retrieve(row.stripe_coupon_id);
    couponValid = coupon.valid ?? true;
    couponTimesRedeemed = coupon.times_redeemed ?? 0;
  } catch {
    couponValid = false;
  }

  // Prefer the promotion code's per-code redemption count + active flag when a code
  // exists; fall back to the coupon's aggregate counts.
  let timesRedeemed = couponTimesRedeemed;
  let promoCodeActive: boolean | null = null;
  if (row.stripe_promotion_code_id) {
    const promoCode = await stripe.promotionCodes.retrieve(row.stripe_promotion_code_id);
    timesRedeemed = promoCode.times_redeemed ?? timesRedeemed;
    promoCodeActive = promoCode.active;
  }

  const nowIso = new Date().toISOString();
  await db
    .from("promotions")
    .update({
      times_redeemed: timesRedeemed,
      stripe_coupon_active: couponValid,
      stripe_promotion_code_active: promoCodeActive,
      last_synced_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", promotionId);

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "billing_admin",
    action: "sync_promotion",
    targetType: "promotion",
    targetId: promotionId,
    metadata: {
      name: row.name,
      stripeCouponId: row.stripe_coupon_id,
      timesRedeemed,
      couponValid,
    },
  });
}

/** Archive a promotion: deactivate locally + disable the Stripe coupon (and promotion
 *  code) so it can no longer be redeemed. */
export async function archivePromotion(promotionId: string, reason: string): Promise<void> {
  const ctx = await requireAdminContext("manage:promotions");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A reason is required to archive a promotion.");
  }

  const db = getAdminDb();
  const { data, error } = await db
    .from("promotions")
    .select("id, name, stripe_coupon_id, stripe_promotion_code_id")
    .eq("id", promotionId)
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Promotion not found.");
  }
  const row = data as {
    id: string;
    name: string;
    stripe_coupon_id: string;
    stripe_promotion_code_id?: string | null;
  };

  const stripe = getStripe();
  // Disable the customer-facing promotion code (the redemption gate) and delete the
  // underlying coupon. Stripe coupons have no `valid` update — deletion is the only way
  // to fully deactivate one, which is why this action is marked irreversible.
  if (row.stripe_promotion_code_id) {
    await stripe.promotionCodes.update(row.stripe_promotion_code_id, { active: false });
  }
  try {
    await stripe.coupons.del(row.stripe_coupon_id);
  } catch {
    // The coupon may already be deleted (e.g. a prior archive). Don't fail the action —
    // the local row is still marked archived below.
  }

  const nowIso = new Date().toISOString();
  await db
    .from("promotions")
    .update({
      active: false,
      stripe_coupon_active: false,
      stripe_promotion_code_active: row.stripe_promotion_code_id ? false : null,
      updated_at: nowIso,
    })
    .eq("id", promotionId);

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "billing_admin",
    action: "archive_promotion",
    targetType: "promotion",
    targetId: promotionId,
    reason,
    metadata: {
      name: row.name,
      stripeCouponId: row.stripe_coupon_id,
      stripePromotionCodeId: row.stripe_promotion_code_id ?? null,
    },
  });
}
