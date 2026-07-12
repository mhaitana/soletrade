import "server-only";
import { getAdminDb } from "./db";
import type { Promotion, PromotionDiscountType, PromotionDuration } from "@/platform/admin/types";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";

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
      stripe_promotion_code_id?: string;
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
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    internalDescription: row.internal_description,
    publicCode: row.public_code,
    stripeCouponId: row.stripe_coupon_id,
    stripePromotionCodeId: row.stripe_promotion_code_id,
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
  }));
}

export interface CreatePromotionParams {
  name: string;
  internalDescription?: string;
  publicCode?: string;
  stripeCouponId: string;
  discountType: PromotionDiscountType;
  percentOff?: number;
  amountOffCents?: number;
  duration: PromotionDuration;
  durationInMonths?: number;
  maxRedemptions?: number;
  newCustomersOnly?: boolean;
  reason: string;
}

export async function createPromotion(params: CreatePromotionParams): Promise<Promotion> {
  const ctx = await requireAdminContext("manage:promotions");
  if (!params.reason || params.reason.trim().length < 3) {
    throw new Error("A reason is required to create a promotion.");
  }

  const db = getAdminDb();
  const { data, error } = await db
    .from("promotions")
    .insert({
      name: params.name,
      internal_description: params.internalDescription ?? null,
      public_code: params.publicCode ?? null,
      stripe_coupon_id: params.stripeCouponId,
      discount_type: params.discountType,
      percent_off: params.percentOff ?? null,
      amount_off_cents: params.amountOffCents ?? null,
      duration: params.duration,
      duration_in_months: params.durationInMonths ?? null,
      max_redemptions: params.maxRedemptions ?? null,
      new_customers_only: params.newCustomersOnly ?? false,
      active: true,
      created_by_admin_id: ctx.adminUser.id,
    })
    .select()
    .single();

  if (error || !data) {
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
    metadata: { name: params.name, stripeCouponId: params.stripeCouponId },
  });

  const list = await listPromotions();
  return list.find((p) => p.id === createdId)!;
}
