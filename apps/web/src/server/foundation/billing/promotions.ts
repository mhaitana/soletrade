import type { PromotionPreview, CheckoutPromotion } from "@/lib/domain/billing/promotions-types";
export type { PromotionPreview, CheckoutPromotion } from "@/lib/domain/billing/promotions-types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { parsePgTimestamp, unwrapMaybe, unwrapVoid } from "@/server/infrastructure/db/helpers";
import { isModuleKey, type ModuleKey } from "@/config/modules";
import type { WorkspaceId } from "@/types/ids";
import { formatCents, type Interval } from "@/lib/domain/billing/pricing";
import { normalizePromotionCode } from "@/lib/domain/billing/signup-intent";

const PROMOTION_COLUMNS =
  "id, public_code, stripe_promotion_code_id, discount_type, percent_off, amount_off_cents, currency, duration, duration_in_months, max_redemptions, redeem_by, applies_to_modules, applies_to_intervals, new_customers_only, active, times_redeemed, stripe_coupon_active, stripe_promotion_code_active";

interface PromotionRecord {
  id: string;
  public_code: string | null;
  stripe_promotion_code_id: string | null;
  discount_type: "percentage" | "fixed_amount";
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string | null;
  duration: "once" | "repeating" | "forever";
  duration_in_months: number | null;
  max_redemptions: number | null;
  redeem_by: string | null;
  applies_to_modules: string[] | null;
  applies_to_intervals: string[] | null;
  new_customers_only: boolean;
  active: boolean;
  times_redeemed: number;
  stripe_coupon_active: boolean | null;
  stripe_promotion_code_active: boolean | null;
}

function isCurrentlyRedeemable(row: PromotionRecord, now = new Date()): boolean {
  if (!row.active || row.stripe_coupon_active === false) return false;
  if (!row.stripe_promotion_code_id || row.stripe_promotion_code_active === false) return false;
  if (row.redeem_by && parsePgTimestamp(row.redeem_by).getTime() < now.getTime()) return false;
  if (row.max_redemptions != null && row.times_redeemed >= row.max_redemptions) return false;
  if (row.discount_type === "percentage" && !(Number(row.percent_off) > 0)) return false;
  if (row.discount_type === "fixed_amount" && !(Number(row.amount_off_cents) > 0)) return false;
  if (row.discount_type === "fixed_amount" && (row.currency ?? "AUD") !== "AUD") return false;
  return true;
}

function toPreview(row: PromotionRecord): PromotionPreview {
  const code = normalizePromotionCode(row.public_code) ?? "";
  return {
    code,
    discountType: row.discount_type,
    ...(row.percent_off != null ? { percentOff: Number(row.percent_off) } : {}),
    ...(row.amount_off_cents != null ? { amountOffCents: row.amount_off_cents } : {}),
    currency: row.currency ?? "AUD",
    duration: row.duration,
    ...(row.duration_in_months != null ? { durationInMonths: row.duration_in_months } : {}),
    newCustomersOnly: row.new_customers_only,
  };
}

async function findPromotion(code: string): Promise<PromotionRecord | null> {
  const normalized = normalizePromotionCode(code);
  if (!normalized) return null;
  const row = await unwrapMaybe(
    getDataClient()
      .from("promotions")
      .select(PROMOTION_COLUMNS)
      .ilike("public_code", normalized)
      .limit(1)
      .maybeSingle(),
  );
  return row as PromotionRecord | null;
}

/** Safe subset rendered on public signup and billing pages. */
export async function getPromotionPreview(code: string): Promise<PromotionPreview | null> {
  const row = await findPromotion(code);
  return row && isCurrentlyRedeemable(row) ? toPreview(row) : null;
}

function supportsInterval(values: string[] | null, interval: Interval): boolean {
  if (!values || values.length === 0) return true;
  const aliases = interval === "monthly" ? ["month", "monthly"] : ["year", "annual", "yearly"];
  return values.some((value) => aliases.includes(value.toLowerCase()));
}

/**
 * Re-read and validate the linked offer at the authenticated checkout boundary.
 * Stripe performs the final redemption-limit/customer checks when creating the session.
 */
export async function resolveCheckoutPromotion(
  code: string,
  opts: { moduleKeys: readonly ModuleKey[]; interval: Interval },
): Promise<CheckoutPromotion | null> {
  const row = await findPromotion(code);
  if (
    !row ||
    !isCurrentlyRedeemable(row) ||
    !supportsInterval(row.applies_to_intervals, opts.interval)
  ) {
    return null;
  }
  const scopedModules = (row.applies_to_modules ?? []).filter(isModuleKey);
  if (scopedModules.length > 0 && !opts.moduleKeys.some((key) => scopedModules.includes(key))) {
    return null;
  }
  return {
    ...toPreview(row),
    id: row.id,
    stripePromotionCodeId: row.stripe_promotion_code_id!,
  };
}

export function promotionLabel(promotion: PromotionPreview): string {
  const discount =
    promotion.discountType === "percentage"
      ? `${promotion.percentOff ?? 0}% off`
      : `${formatCents(promotion.amountOffCents ?? 0, promotion.currency)} off`;
  if (promotion.duration === "forever") return `${discount} ongoing`;
  if (promotion.duration === "repeating") {
    const months = promotion.durationInMonths ?? 1;
    return `${discount} for ${months} ${months === 1 ? "month" : "months"}`;
  }
  return `${discount} your first payment`;
}

/** Idempotent-enough webhook record; event-id de-duplication is the primary guard. */
export async function recordPromotionRedemption(input: {
  promotionId: string;
  workspaceId: WorkspaceId;
  stripeSubscriptionId: string;
}): Promise<void> {
  const existing = await unwrapMaybe(
    getDataClient()
      .from("promotion_redemptions")
      .select("id")
      .eq("promotion_id", input.promotionId)
      .eq("workspace_id", input.workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (existing) return;
  await unwrapVoid(
    getDataClient().from("promotion_redemptions").insert({
      promotion_id: input.promotionId,
      workspace_id: input.workspaceId,
      stripe_subscription_id: input.stripeSubscriptionId,
    }),
  );
}
