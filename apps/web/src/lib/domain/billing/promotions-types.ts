export interface PromotionPreview {
  code: string;
  discountType: "percentage" | "fixed_amount";
  percentOff?: number;
  amountOffCents?: number;
  currency: string;
  duration: "once" | "repeating" | "forever";
  durationInMonths?: number;
  newCustomersOnly: boolean;
}

export interface CheckoutPromotion extends PromotionPreview {
  id: string;
  stripePromotionCodeId: string;
}
