import { getBillingState as getMobileBilling } from "@/server/foundation/billing/state";
export { getBillingState as getMobileBilling } from "@/server/foundation/billing/state";
import "server-only";
import { createHash } from "node:crypto";
import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
  Status,
} from "@apple/app-store-server-library";
import { GoogleAuth } from "google-auth-library";
import { z } from "zod";
import { mobileStoreIntentSchema, mobileStoreIntentCancelSchema } from "@soletrade/contracts";
import { getDataClient } from "@/server/infrastructure/db/client";
import { getSubscription } from "@/server/foundation/billing/subscriptions";
import { getCreditBalance, listCreditLedger } from "@/server/foundation/billing/credits";
import { getInstalledModules } from "@/server/foundation/module-installations";
import { getWorkspace } from "@/server/foundation/workspaces";
import type { UserId, WorkspaceId } from "@/types/ids";
import { MobileApiError } from "@/server/application/mobile/http";
import { findStoreOffer, generateStoreOffers } from "@/lib/domain/billing/catalog";

export async function getMobileBillingDetails(workspaceId: WorkspaceId) {
  const [billing, subscription, modules, balanceCents, ledger] = await Promise.all([
    getMobileBilling(workspaceId),
    getSubscription(workspaceId),
    getInstalledModules(workspaceId),
    getCreditBalance(workspaceId),
    listCreditLedger(workspaceId, { limit: 30 }),
  ]);
  const managementUrl =
    billing.provider === "apple"
      ? "https://apps.apple.com/account/subscriptions"
      : billing.provider === "google"
        ? `https://play.google.com/store/account/subscriptions?package=${encodeURIComponent(process.env.MOBILE_BUNDLE_ID ?? "au.com.soletrade.business")}`
        : null;
  return {
    ...billing,
    modules,
    billingInterval: billing.interval ?? subscription?.billingInterval ?? null,
    balanceCents,
    currency: "AUD",
    recentLedger: ledger,
    managementUrl,
    creditNote:
      "Web credits apply to Stripe billing and cannot pay for App Store or Google Play renewals.",
  };
}

export async function storeCatalog(
  userId: UserId,
  workspaceId: WorkspaceId,
  purchaseProvider?: "apple" | "google",
) {
  const [workspace, billing, bindingResult, contractResult, intentResult] = await Promise.all([
    getWorkspace(workspaceId),
    getMobileBilling(workspaceId),
    getDataClient()
      .from("store_workspace_bindings")
      .select("workspace_id,provider")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    getDataClient()
      .from("billing_contracts")
      .select("owner_user_id,external_id,product_key,modules,provider,interval")
      .eq("workspace_id", workspaceId)
      .eq("current", true)
      .maybeSingle(),
    getDataClient()
      .from("mobile_store_purchase_intents")
      .select("workspace_id,provider,offer_key")
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle(),
  ]);
  if (bindingResult.error || contractResult.error || intentResult.error)
    throw new Error("Unable to load purchase binding");
  const boundElsewhere = bindingResult.data && bindingResult.data.workspace_id !== workspaceId;
  const pendingElsewhere =
    intentResult.data &&
    (intentResult.data.workspace_id !== workspaceId ||
      (purchaseProvider && intentResult.data.provider !== purchaseProvider));
  const futureCoverage = Boolean(
    billing.paidThrough && new Date(billing.paidThrough).getTime() > Date.now(),
  );
  const covered =
    billing.provider === "stripe"
      ? ["active", "past_due"].includes(billing.status) ||
        (Boolean(contractResult.data?.external_id.startsWith("checkout:")) && futureCoverage)
      : Boolean(billing.provider) &&
        ["active", "grace", "canceled"].includes(billing.status) &&
        futureCoverage;
  const recovering =
    (billing.provider === "apple" || billing.provider === "google") &&
    ["billing_retry", "on_hold", "paused"].includes(billing.status);
  const configured = process.env.MOBILE_STORE_PURCHASES_ENABLED === "true";
  const reason = !configured
    ? "Store purchases are not enabled for this environment."
    : workspace?.ownerId !== userId
      ? "Only the workspace owner can purchase a subscription."
      : boundElsewhere
        ? "Your store subscription is linked to another workspace."
        : recovering
          ? "Fix or cancel payment with the original store, then restore to refresh its status before purchasing again."
          : pendingElsewhere
            ? "Another store purchase is pending. Complete or cancel it in its original workspace."
            : covered &&
                billing.provider !== "stripe" &&
                contractResult.data?.owner_user_id !== userId
              ? "The original purchaser manages this subscription until its coverage ends."
              : covered &&
                  (billing.provider === "stripe" ||
                    (purchaseProvider && billing.provider !== purchaseProvider))
                ? "This workspace is already covered. Manage its subscription through the original purchase provider."
                : undefined;
  return {
    offers: generateStoreOffers(),
    billing,
    binding: bindingResult.data ? { workspaceId: bindingResult.data.workspace_id } : null,
    purchaseAllowed: !reason,
    currentOfferKey: contractResult.data?.product_key ?? null,
    currentOfferActive: Boolean(covered),
    googleReplacement:
      covered &&
      billing.provider === "google" &&
      contractResult.data?.owner_user_id === userId &&
      workspace?.ownerId === userId
        ? {
            purchaseToken: contractResult.data.external_id,
            productId: generateStoreOffers().find(
              (offer) => offer.key === contractResult.data!.product_key,
            )?.googleProductId,
            basePlanId: contractResult.data.interval,
            modules: contractResult.data.modules,
          }
        : null,
    ...(reason ? { reason } : {}),
  };
}

export async function startStorePurchaseIntent(
  userId: UserId,
  workspaceId: WorkspaceId,
  body: unknown,
) {
  if (process.env.MOBILE_STORE_PURCHASES_ENABLED !== "true")
    throw new MobileApiError(
      "STORE_NOT_CONFIGURED",
      "Store purchases are not enabled for this environment.",
      503,
    );
  const input = mobileStoreIntentSchema.parse(body);
  if (input.workspaceId !== workspaceId)
    throw new MobileApiError("WORKSPACE_MISMATCH", "Choose the original purchase workspace.", 409);
  if (!generateStoreOffers().some((offer) => offer.key === input.offerKey))
    throw new MobileApiError("UNKNOWN_PRODUCT", "That subscription offer is unavailable.", 422);
  const { data, error } = await getDataClient().rpc("mobile_start_store_purchase_intent", {
    p_id: input.operationId,
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_provider: input.provider,
    p_offer_key: input.offerKey,
  });
  if (error || !data)
    throw new MobileApiError(
      "PURCHASE_INTENT_CONFLICT",
      "A purchase is already pending, this workspace has another subscription, or store purchases belong to your original workspace. Complete or cancel the original store purchase before trying again.",
      409,
    );
  return { intentId: data };
}

export async function cancelStorePurchaseIntent(
  userId: UserId,
  workspaceId: WorkspaceId,
  body: unknown,
) {
  const input = mobileStoreIntentCancelSchema.parse(body);
  if (input.workspaceId !== workspaceId)
    throw new MobileApiError("WORKSPACE_MISMATCH", "Choose the original purchase workspace.", 409);
  const { data, error } = await getDataClient().rpc("mobile_cancel_store_purchase_intent", {
    p_id: input.intentId,
    p_user_id: userId,
    p_workspace_id: workspaceId,
  });
  if (error)
    throw new MobileApiError(
      "PURCHASE_INTENT_CONFLICT",
      "This purchase intent cannot be cancelled from this workspace.",
      409,
    );
  return { cancelled: data === true };
}

export const storeVerificationSchema = z
  .object({
    workspaceId: z.uuid(),
    provider: z.enum(["apple", "google"]),
    productId: z.string().min(1).max(200),
    transactionId: z.string().max(300).optional(),
    signedTransactionInfo: z.string().max(40_000).optional(),
    purchaseToken: z.string().max(40_000).optional(),
    basePlanId: z.string().max(100).optional(),
    intentId: z.uuid().optional(),
  })
  .strict();
type StoreInput = z.infer<typeof storeVerificationSchema>;
export interface VerifiedStorePurchase {
  provider: "apple" | "google";
  externalId: string;
  productId: string;
  basePlanId?: string;
  accountId: string;
  profileId?: string;
  status: string;
  paidThrough: string | null;
  graceUntil: string | null;
  renews: boolean;
  environment: string;
  /** Allocated before provider I/O; only a trusted verifier may supply this. */
  verificationRevision: number;
  /** Google's verified replacement chain, never a client-supplied token link. */
  previousExternalId?: string;
  pendingProductId?: string;
  pendingBasePlanId?: string;
}

async function nextVerificationRevision(): Promise<number> {
  const { data, error } = await getDataClient().rpc("mobile_next_verification");
  if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data <= 0)
    throw new Error("Unable to order store verification");
  return data;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new MobileApiError(
      "STORE_NOT_CONFIGURED",
      "Store verification is not configured for this environment.",
      503,
    );
  return value.replace(/\\n/g, "\n");
}
export function appleConfiguration() {
  const environment =
    process.env.APPLE_STORE_ENVIRONMENT === "Sandbox"
      ? Environment.SANDBOX
      : Environment.PRODUCTION;
  const bundleId = process.env.MOBILE_BUNDLE_ID ?? "au.com.soletrade.business";
  const certificates = z
    .array(z.string().min(1))
    .min(1)
    .parse(JSON.parse(required("APPLE_ROOT_CERTIFICATES_BASE64")))
    .map((value) => Buffer.from(value, "base64"));
  const verifier = new SignedDataVerifier(
    certificates,
    true,
    environment,
    bundleId,
    environment === Environment.PRODUCTION ? Number(required("APPLE_APP_ID")) : undefined,
  );
  const client = new AppStoreServerAPIClient(
    required("APPLE_IAP_PRIVATE_KEY"),
    required("APPLE_IAP_KEY_ID"),
    required("APPLE_IAP_ISSUER_ID"),
    bundleId,
    environment,
  );
  return { environment, verifier, client };
}

export async function verifyApplePurchase(
  input: Pick<StoreInput, "transactionId" | "signedTransactionInfo">,
): Promise<VerifiedStorePurchase> {
  const verificationRevision = await nextVerificationRevision();
  const { client, verifier } = appleConfiguration();
  let transactionId = input.transactionId;
  if (!transactionId && input.signedTransactionInfo)
    transactionId = (await verifier.verifyAndDecodeTransaction(input.signedTransactionInfo))
      .transactionId;
  if (!transactionId)
    throw new MobileApiError("MISSING_TRANSACTION", "The App Store transaction is missing.");
  // Always fetch current provider state: an old, valid signed purchase must not restore revoked access.
  const statuses = await client.getAllSubscriptionStatuses(transactionId);
  const entries = statuses.data?.flatMap((group) => group.lastTransactions ?? []) ?? [];
  const verified = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      transaction: entry.signedTransactionInfo
        ? await verifier.verifyAndDecodeTransaction(entry.signedTransactionInfo)
        : null,
      renewal: entry.signedRenewalInfo
        ? await verifier.verifyAndDecodeRenewalInfo(entry.signedRenewalInfo)
        : null,
    })),
  );
  const candidates = verified
    .filter((item) => item.transaction?.originalTransactionId)
    .sort((a, b) => (b.transaction?.purchaseDate ?? 0) - (a.transaction?.purchaseDate ?? 0));
  const latest = candidates[0];
  const transaction = latest?.transaction;
  if (
    !latest ||
    !transaction?.originalTransactionId ||
    !transaction.productId ||
    !transaction.appAccountToken
  )
    throw new MobileApiError(
      "INVALID_PURCHASE",
      "This purchase cannot be linked to your Soletrade account.",
      422,
    );
  const state = latest.entry.status;
  if (
    ![
      Status.ACTIVE,
      Status.EXPIRED,
      Status.BILLING_RETRY,
      Status.BILLING_GRACE_PERIOD,
      Status.REVOKED,
    ].includes(state as Status)
  )
    throw new MobileApiError(
      "STORE_STATE_UNAVAILABLE",
      "The App Store subscription state is unavailable. Try restoring again later.",
      503,
    );
  return {
    provider: "apple",
    externalId: transaction.originalTransactionId,
    productId: transaction.productId,
    accountId: transaction.appAccountToken,
    status:
      transaction.revocationDate || state === Status.REVOKED
        ? "revoked"
        : state === Status.BILLING_GRACE_PERIOD
          ? "grace"
          : state === Status.BILLING_RETRY
            ? "billing_retry"
            : state === Status.ACTIVE
              ? "active"
              : "expired",
    paidThrough: transaction.expiresDate ? new Date(transaction.expiresDate).toISOString() : null,
    graceUntil: latest.renewal?.gracePeriodExpiresDate
      ? new Date(latest.renewal.gracePeriodExpiresDate).toISOString()
      : null,
    renews: latest.renewal?.autoRenewStatus === 1,
    environment: String(transaction.environment),
    verificationRevision,
    ...(latest.renewal?.autoRenewStatus === 1 &&
    latest.renewal.autoRenewProductId &&
    latest.renewal.autoRenewProductId !== transaction.productId
      ? { pendingProductId: latest.renewal.autoRenewProductId }
      : {}),
  };
}

interface GooglePurchase {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    deferredItemReplacement?: { productId?: string };
    offerDetails?: { basePlanId?: string };
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  testPurchase?: object;
}
export async function googleClient() {
  const credentials: unknown = JSON.parse(required("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"));
  if (!credentials || typeof credentials !== "object")
    throw new MobileApiError("STORE_NOT_CONFIGURED", "Google verification is not configured.", 503);
  return new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  }).getClient();
}
export async function verifyGooglePurchase(purchaseToken: string): Promise<VerifiedStorePurchase> {
  const verificationRevision = await nextVerificationRevision();
  const client = await googleClient();
  const packageName = process.env.MOBILE_BUNDLE_ID ?? "au.com.soletrade.business";
  const { data } = await client.request<GooglePurchase>({
    url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
  });
  const state = data.subscriptionState;
  // Payment-pending is different from acknowledgement-pending. Never replace
  // existing paid coverage with an uncompleted or canceled pending purchase.
  if (
    state === "SUBSCRIPTION_STATE_PENDING" ||
    state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"
  )
    throw new MobileApiError(
      state === "SUBSCRIPTION_STATE_PENDING" ? "PURCHASE_PENDING" : "PURCHASE_CANCELED",
      state === "SUBSCRIPTION_STATE_PENDING"
        ? "Google Play is still processing payment. Existing access is unchanged."
        : "Google Play canceled this pending purchase. Existing access is unchanged.",
      409,
    );
  if (
    !state ||
    ![
      "SUBSCRIPTION_STATE_ACTIVE",
      "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
      "SUBSCRIPTION_STATE_CANCELED",
      "SUBSCRIPTION_STATE_ON_HOLD",
      "SUBSCRIPTION_STATE_PAUSED",
      "SUBSCRIPTION_STATE_EXPIRED",
    ].includes(state)
  )
    throw new MobileApiError(
      "STORE_STATE_UNAVAILABLE",
      "Google Play subscription state is unavailable. Try restoring again later.",
      503,
    );
  const lines = data.lineItems ?? [];
  const datedLines = lines.filter(
    (item) => item.expiryTime && Number.isFinite(Date.parse(item.expiryTime)),
  );
  // Google supplies the old, currently owned line with a future expiry and a
  // deferredItemReplacement marker. The future line has no expiry until renewal.
  // https://developer.android.com/google/play/billing/subscriptions#handle-deferred-replacement
  const recovering =
    state === "SUBSCRIPTION_STATE_ON_HOLD" || state === "SUBSCRIPTION_STATE_PAUSED";
  const deferredCurrent = datedLines.find(
    (item) =>
      item.deferredItemReplacement?.productId &&
      (recovering || Date.parse(item.expiryTime!) > Date.now()),
  );
  const line =
    deferredCurrent ??
    datedLines.sort((a, b) => Date.parse(b.expiryTime!) - Date.parse(a.expiryTime!))[0];
  const pendingProductId = deferredCurrent?.deferredItemReplacement?.productId;
  const pendingLine = pendingProductId
    ? lines.find(
        (item) =>
          item !== deferredCurrent && item.productId === pendingProductId && !item.expiryTime,
      )
    : undefined;
  if (!line?.productId || !data.externalAccountIdentifiers?.obfuscatedExternalAccountId)
    throw new MobileApiError(
      "INVALID_PURCHASE",
      "This purchase cannot be linked to your Soletrade account.",
      422,
    );
  return {
    provider: "google",
    externalId: purchaseToken,
    productId: line.productId,
    basePlanId: line.offerDetails?.basePlanId,
    accountId: data.externalAccountIdentifiers.obfuscatedExternalAccountId,
    profileId: data.externalAccountIdentifiers.obfuscatedExternalProfileId,
    status:
      state === "SUBSCRIPTION_STATE_ACTIVE"
        ? "active"
        : state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
          ? "grace"
          : state === "SUBSCRIPTION_STATE_CANCELED"
            ? "canceled"
            : state === "SUBSCRIPTION_STATE_ON_HOLD"
              ? "on_hold"
              : state === "SUBSCRIPTION_STATE_PAUSED"
                ? "paused"
                : "expired",
    paidThrough: line.expiryTime ?? null,
    graceUntil: null,
    renews:
      pendingLine?.autoRenewingPlan?.autoRenewEnabled ??
      line.autoRenewingPlan?.autoRenewEnabled ??
      false,
    environment: data.testPurchase ? "Sandbox" : "Production",
    verificationRevision,
    ...(data.linkedPurchaseToken ? { previousExternalId: data.linkedPurchaseToken } : {}),
    ...(pendingProductId
      ? { pendingProductId, pendingBasePlanId: pendingLine?.offerDetails?.basePlanId }
      : {}),
  };
}

export async function applyVerifiedPurchase(
  userId: UserId,
  workspaceId: WorkspaceId,
  verified: VerifiedStorePurchase,
  intentId?: string,
) {
  const expectedAccount =
    verified.provider === "apple"
      ? userId.toLowerCase()
      : createHash("sha256").update(userId).digest("hex");
  if (
    verified.accountId.toLowerCase() !== expectedAccount ||
    (verified.provider === "google" &&
      verified.profileId !== createHash("sha256").update(workspaceId).digest("hex"))
  )
    throw new MobileApiError(
      "PURCHASE_ACCOUNT_MISMATCH",
      "Sign into the Soletrade account and workspace originally used for this purchase.",
      409,
    );
  const offer = findStoreOffer(verified.provider, verified.productId, verified.basePlanId);
  if (!offer)
    throw new MobileApiError(
      "UNKNOWN_PRODUCT",
      "That subscription product is not in the Soletrade catalogue.",
      422,
    );
  // A deferred product is display-only until a later trusted snapshot makes it
  // the current entitlement. Its base plan may be absent from Google's marker.
  const pendingOffer = verified.pendingProductId
    ? findStoreOffer(verified.provider, verified.pendingProductId, verified.pendingBasePlanId)
    : undefined;
  const pendingModules =
    pendingOffer?.modules ??
    (verified.provider === "google" && verified.pendingProductId
      ? generateStoreOffers().find(
          (candidate) => candidate.googleProductId === verified.pendingProductId,
        )?.modules
      : undefined);
  const { error } = await getDataClient().rpc("mobile_apply_store_contract", {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_provider: verified.provider,
    p_external_id: verified.externalId,
    p_product_key: offer.key,
    p_modules: offer.modules,
    p_interval: offer.interval,
    p_status: verified.status,
    p_paid_through: verified.paidThrough,
    p_grace_until: verified.graceUntil,
    p_renews: verified.renews,
    p_environment: verified.environment,
    p_previous_external_id: verified.previousExternalId ?? null,
    p_verification_revision: verified.verificationRevision,
    p_pending_modules: pendingModules ?? null,
    p_pending_interval: pendingOffer?.interval ?? null,
    p_intent_id: intentId ?? null,
    p_pending_product_key: pendingOffer?.key ?? null,
  });
  if (error)
    throw new MobileApiError(
      "PURCHASE_BINDING_CONFLICT",
      "This purchase is already linked, or this workspace still has another subscription. Refresh billing before retrying.",
      409,
    );
  const [billing, modules] = await Promise.all([
    getMobileBilling(workspaceId),
    getInstalledModules(workspaceId),
  ]);
  return { billing, modules };
}

export async function verifyStorePurchase(
  userId: UserId,
  workspaceId: WorkspaceId,
  value: unknown,
) {
  if (process.env.MOBILE_STORE_PURCHASES_ENABLED !== "true")
    throw new MobileApiError(
      "STORE_NOT_CONFIGURED",
      "Store purchases are not enabled for this environment.",
      503,
    );
  const input = storeVerificationSchema.parse(value);
  if (input.workspaceId !== workspaceId)
    throw new MobileApiError(
      "WORKSPACE_MISMATCH",
      "The purchase belongs to a different workspace.",
      409,
    );
  const verified =
    input.provider === "apple"
      ? await verifyApplePurchase(input)
      : await verifyGooglePurchase(input.purchaseToken ?? "");
  const result = await applyVerifiedPurchase(userId, workspaceId, verified, input.intentId);
  return result;
}
