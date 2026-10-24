import { SUPPORTED_CURRENCY_CODES, isSupportedCurrency } from "@soletrade/contracts/currencies";
export { SUPPORTED_CURRENCY_CODES as RECEIPT_CURRENCIES };
export function receiptCurrency(value: unknown) {
  const currency = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!isSupportedCurrency(currency))
    throw new Error(
      `Currency ${currency || "(missing)"} is not supported. Review the original currency before applying any amount.`,
    );
  return currency;
}
export function receiptReviewFields(value: Record<string, unknown>) {
  const currency = receiptCurrency(value.currency);
  if (!Number.isSafeInteger(value.totalCents) || Number(value.totalCents) < 0)
    throw new Error("Review the original receipt amount before applying it.");
  return {
    description: String(value.merchant ?? ""),
    amount: String(Number(value.totalCents) / 100),
    currency,
    date: String(value.date ?? ""),
  };
}
