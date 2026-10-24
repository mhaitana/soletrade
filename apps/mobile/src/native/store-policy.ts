import type { MobileBilling, MobileModule } from "@soletrade/contracts";
import type { RequestSubscriptionAndroidProps } from "expo-iap";
export interface GoogleReplacement {
  purchaseToken: string;
  productId: string;
  basePlanId: string;
  modules: MobileModule[];
}
export interface GoogleTarget {
  productId: string;
  basePlanId: string;
  modules: MobileModule[];
}
export type StoreChangeTiming = "initial" | "immediate" | "renewal" | "interval";
interface AvailableGooglePurchase {
  productId: string;
  purchaseToken?: string | null;
  purchaseState?: string;
  obfuscatedAccountIdAndroid?: string | null;
  obfuscatedProfileIdAndroid?: string | null;
}
const sameModules = (a: MobileModule[], b: MobileModule[]) =>
  a.length === b.length && a.every((module) => b.includes(module));
function changeTiming(current: GoogleReplacement, target: GoogleTarget): StoreChangeTiming {
  if (current.productId === target.productId) {
    if (current.basePlanId === target.basePlanId)
      throw new Error("This subscription plan is already selected.");
    return "interval";
  }
  return target.modules.length < current.modules.length &&
    target.modules.every((module) => current.modules.includes(module))
    ? "renewal"
    : "immediate";
}
export function googleChangePreview(
  current: GoogleReplacement | null | undefined,
  target: GoogleTarget,
) {
  if (!current)
    return "Google Play confirms the price, billing date and effective plan before payment.";
  if (current.productId === target.productId && current.basePlanId === target.basePlanId)
    return "Your current plan.";
  const timing = changeTiming(current, target),
    added = target.modules.filter((module) => !current.modules.includes(module)),
    removed = current.modules.filter((module) => !target.modules.includes(module));
  if (timing === "interval")
    return "Change billing interval now. The next charge occurs at the existing renewal date; Google Play confirms the amount.";
  if (timing === "renewal")
    return `Remove ${removed.join(", ")} at renewal. Your current modules remain available until then. Google Play confirms the renewal date and price.`;
  return `${added.length ? `Add ${added.join(", ")}` : "Change your bundle"}${removed.length ? ` and remove ${removed.join(", ")} immediately` : " immediately"}. Google Play applies its billing adjustment and confirms the next charge date.`;
}
export function googlePurchasePayload(input: {
  accountHash: string;
  profileHash: string;
  offerToken: string;
  billing: MobileBilling;
  replacement?: GoogleReplacement | null;
  availablePurchases: AvailableGooglePurchase[];
  target: GoogleTarget;
  now?: number;
}): {
  google: RequestSubscriptionAndroidProps;
  timing: StoreChangeTiming;
  requestedModules: MobileModule[];
} {
  const { target, replacement } = input;
  const covered =
    input.billing.provider === "google" &&
    (["active", "trialing", "grace", "grace_period", "past_due"].includes(input.billing.status) ||
      Boolean(
        input.billing.paidThrough &&
        new Date(input.billing.paidThrough).getTime() > (input.now ?? Date.now()),
      ));
  const google: RequestSubscriptionAndroidProps = {
    skus: [target.productId],
    obfuscatedAccountId: input.accountHash,
    obfuscatedProfileId: input.profileHash,
    subscriptionOffers: [{ sku: target.productId, offerToken: input.offerToken }],
  };
  if (!covered) {
    if (
      input.availablePurchases.some(
        (purchase) => purchase.purchaseState === "purchased" && purchase.purchaseToken,
      )
    )
      throw new Error(
        "Google Play already has a subscription for this app. Restore and verify its original workspace before starting another purchase.",
      );
    return { google, timing: "initial", requestedModules: target.modules };
  }
  if (!replacement?.purchaseToken || !replacement.productId || !replacement.basePlanId)
    throw new Error(
      "Restore the current Google Play subscription before changing plans. Its verified replacement token is unavailable.",
    );
  const owned = input.availablePurchases.find(
    (purchase) => purchase.purchaseToken === replacement.purchaseToken,
  );
  if (
    owned &&
    (owned.productId !== replacement.productId ||
      (owned.obfuscatedAccountIdAndroid &&
        owned.obfuscatedAccountIdAndroid !== input.accountHash) ||
      (owned.obfuscatedProfileIdAndroid && owned.obfuscatedProfileIdAndroid !== input.profileHash))
  )
    throw new Error(
      "The current Google Play subscription belongs to its original account and workspace. Restore with the original store account before changing plans.",
    );
  // The server-owned token remains mandatory even when another Google account is active on-device.
  // Passing it lets Play reject ownership, instead of silently opening a second subscription.
  const timing = changeTiming(replacement, target);
  google.purchaseToken = replacement.purchaseToken;
  google.subscriptionProductReplacementParams = {
    oldProductId: replacement.productId,
    replacementMode:
      timing === "renewal"
        ? "deferred"
        : timing === "interval"
          ? "without-proration"
          : "with-time-proration",
  };
  return { google, timing, requestedModules: target.modules };
}
export function verifiedPurchaseMessage(
  timing: StoreChangeTiming | undefined,
  requested: MobileModule[] | undefined,
  current: MobileModule[],
  pending: MobileModule[] | null | undefined,
) {
  if (requested && sameModules(requested, current))
    return "Purchase verified for this workspace. The server confirms the requested modules are active.";
  if (timing === "renewal" && requested && pending && sameModules(requested, pending))
    return "The change is verified and scheduled for renewal. Your current modules remain active until the store makes the new plan effective.";
  if (timing === "renewal")
    return "The store change was submitted, but its scheduled entitlement is not yet confirmed by the server. Current access remains unchanged. Refresh or restore to check its status.";
  if (requested)
    return "The purchase was verified, but the requested modules are not yet confirmed as active. Current access follows the server. Refresh or restore to check its status.";
  return "Purchase verified. Current access follows the server-confirmed workspace subscription.";
}

export function canFinishVerifiedPurchase(billing: MobileBilling, now = Date.now()) {
  return (
    ["active", "trialing", "grace", "grace_period"].includes(billing.status) ||
    (billing.status === "canceled" &&
      !!billing.paidThrough &&
      new Date(billing.paidThrough).getTime() > now)
  );
}
