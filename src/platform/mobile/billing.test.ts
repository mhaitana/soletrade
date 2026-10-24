// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserId, WorkspaceId } from "@/shared/types/ids";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  googleRequest: vi.fn(),
  appleStatuses: vi.fn(),
  transaction: vi.fn(),
  renewal: vi.fn(),
  billing: vi.fn(),
  modules: vi.fn(),
  subscription: vi.fn(),
  workspace: vi.fn(),
  binding: vi.fn(),
  contract: vi.fn(),
  intent: vi.fn(),
  calls: [] as string[],
}));
vi.mock("@/server/db/client", () => ({
  getDataClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      let columns = "";
      const query = {
        select: (value: string) => {
          columns = value;
          return query;
        },
        eq: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () =>
          table === "store_workspace_bindings"
            ? mocks.binding()
            : table === "mobile_store_purchase_intents"
              ? mocks.intent()
              : columns.includes("owner_user_id")
                ? mocks.contract()
                : mocks.billing(),
      };
      return query;
    },
  }),
}));
vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { request: mocks.googleRequest };
    }
  },
}));
vi.mock("@apple/app-store-server-library", () => ({
  Environment: { SANDBOX: "Sandbox", PRODUCTION: "Production" },
  Status: { ACTIVE: 1, EXPIRED: 2, REVOKED: 5, BILLING_GRACE_PERIOD: 4, BILLING_RETRY: 3 },
  AppStoreServerAPIClient: class {
    getAllSubscriptionStatuses = mocks.appleStatuses;
  },
  SignedDataVerifier: class {
    verifyAndDecodeTransaction = mocks.transaction;
    verifyAndDecodeRenewalInfo = mocks.renewal;
  },
}));
vi.mock("@/platform/mobile/http", () => ({
  MobileApiError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/platform/module-installations", () => ({ getInstalledModules: mocks.modules }));
vi.mock("@/platform/billing/subscriptions", () => ({ getSubscription: mocks.subscription }));
vi.mock("@/platform/billing/credits", () => ({
  getCreditBalance: vi.fn(),
  listCreditLedger: vi.fn(),
}));
vi.mock("@/platform/workspaces", () => ({ getWorkspace: mocks.workspace }));

import {
  applyVerifiedPurchase,
  getMobileBilling,
  startStorePurchaseIntent,
  cancelStorePurchaseIntent,
  storeCatalog,
  storeVerificationSchema,
  verifyApplePurchase,
  verifyGooglePurchase,
} from "./billing";
import { createHash } from "node:crypto";
import { hasStoreCoverage, type BillingAuthority } from "@/platform/billing/authority";

const user = "11111111-1111-4111-8111-111111111111" as UserId;
const workspace = "22222222-2222-4222-8222-222222222222" as WorkspaceId;
const googleData = () => ({
  subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
  linkedPurchaseToken: "verified-parent-token",
  lineItems: [
    {
      productId: "business_books",
      expiryTime: "2099-01-01T00:00:00Z",
      offerDetails: { basePlanId: "monthly" },
    },
  ],
  externalAccountIdentifiers: {
    obfuscatedExternalAccountId: createHash("sha256").update(user).digest("hex"),
    obfuscatedExternalProfileId: createHash("sha256").update(workspace).digest("hex"),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  let revision = 0;
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "mobile_next_verification") {
      mocks.calls.push("revision");
      return { data: ++revision, error: null };
    }
    return { data: {}, error: null };
  });
  mocks.googleRequest.mockImplementation(async () => {
    mocks.calls.push("google");
    return { data: googleData() };
  });
  mocks.appleStatuses.mockImplementation(async () => {
    mocks.calls.push("apple");
    return {
      data: [{ lastTransactions: [{ status: 1, signedTransactionInfo: "trusted-transaction" }] }],
    };
  });
  mocks.transaction.mockResolvedValue({
    originalTransactionId: "original",
    productId: "au.com.soletrade.business.books.monthly",
    appAccountToken: user,
    purchaseDate: 1,
    expiresDate: Date.parse("2099-01-01"),
    environment: "Sandbox",
  });
  mocks.billing.mockResolvedValue({
    data: { provider: "google", status: "active", paid_through: "2099-01-01", grace_until: null },
    error: null,
  });
  mocks.modules.mockResolvedValue(["books"]);
  mocks.workspace.mockResolvedValue({ ownerId: user });
  mocks.binding.mockResolvedValue({ data: null, error: null });
  mocks.contract.mockResolvedValue({ data: null, error: null });
  mocks.intent.mockResolvedValue({ data: null, error: null });
  vi.stubEnv("MOBILE_STORE_PURCHASES_ENABLED", "true");
  vi.stubEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "{}");
  vi.stubEnv("APPLE_STORE_ENVIRONMENT", "Sandbox");
  vi.stubEnv("APPLE_ROOT_CERTIFICATES_BASE64", '["dGVzdA=="]');
  vi.stubEnv("APPLE_IAP_PRIVATE_KEY", "test");
  vi.stubEnv("APPLE_IAP_KEY_ID", "test");
  vi.stubEnv("APPLE_IAP_ISSUER_ID", "test");
});
afterEach(() => vi.unstubAllEnvs());

describe("trusted store verification ordering and replacement binding", () => {
  it("allocates a revision before Google I/O and carries only its verified parent token", async () => {
    const verified = await verifyGooglePurchase("new-token");
    expect(mocks.calls).toEqual(["revision", "google"]);
    expect(verified).toMatchObject({
      externalId: "new-token",
      previousExternalId: "verified-parent-token",
      verificationRevision: 1,
    });
  });

  it("allocates a revision before Apple provider I/O", async () => {
    const verified = await verifyApplePurchase({ transactionId: "transaction" });
    expect(mocks.calls).toEqual(["revision", "apple"]);
    expect(verified.verificationRevision).toBe(1);
  });

  it.each([
    ["SUBSCRIPTION_STATE_ON_HOLD", "on_hold"],
    ["SUBSCRIPTION_STATE_PAUSED", "paused"],
  ])(
    "preserves recoverable Google state %s without granting future deferred access",
    async (providerStatus, status) => {
      const data = googleData();
      mocks.googleRequest.mockResolvedValue({
        data: {
          ...data,
          subscriptionState: providerStatus,
          lineItems: [
            {
              ...data.lineItems[0],
              expiryTime: "2000-01-01T00:00:00Z",
              deferredItemReplacement: { productId: "business_drive" },
            },
            { productId: "business_drive", offerDetails: { basePlanId: "annual" } },
          ],
        },
      });
      expect(await verifyGooglePurchase("recoverable-token")).toMatchObject({
        status,
        productId: "business_books",
        paidThrough: "2000-01-01T00:00:00Z",
        pendingProductId: "business_drive",
        pendingBasePlanId: "annual",
      });
    },
  );

  it.each([undefined, "SUBSCRIPTION_STATE_UNSPECIFIED", "FUTURE_UNKNOWN_STATE"])(
    "rejects unrecognized Google state %s without treating it as expiry",
    async (subscriptionState) => {
      mocks.googleRequest.mockResolvedValue({ data: { ...googleData(), subscriptionState } });
      await expect(verifyGooglePurchase("unchanged-token")).rejects.toMatchObject({
        code: "STORE_STATE_UNAVAILABLE",
        status: 503,
      });
    },
  );

  it.each([undefined, 999])(
    "rejects unrecognized Apple state %s without treating it as expiry",
    async (status) => {
      mocks.appleStatuses.mockResolvedValue({
        data: [{ lastTransactions: [{ status, signedTransactionInfo: "trusted" }] }],
      });
      await expect(verifyApplePurchase({ transactionId: "original" })).rejects.toMatchObject({
        code: "STORE_STATE_UNAVAILABLE",
        status: 503,
      });
    },
  );

  it.each(["billing_retry", "on_hold", "paused", "expired", "refunded", "revoked"])(
    "keeps billing guard obligations distinct from ended status %s",
    (status) => {
      expect(
        hasStoreCoverage({
          status,
          paid_through: "2000-01-01",
          grace_until: null,
        } as BillingAuthority),
      ).toBe(["billing_retry", "on_hold", "paused"].includes(status));
    },
  );

  it("preserves Apple billing retry independently of expired access", async () => {
    mocks.appleStatuses.mockResolvedValue({
      data: [{ lastTransactions: [{ status: 3, signedTransactionInfo: "trusted" }] }],
    });
    expect(await verifyApplePurchase({ transactionId: "original" })).toMatchObject({
      status: "billing_retry",
    });
  });

  it("preserves start order when an older provider response finishes after a revocation", async () => {
    let release!: (value: { data: ReturnType<typeof googleData> }) => void;
    mocks.googleRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const older = verifyGooglePurchase("new-token");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    mocks.googleRequest.mockResolvedValueOnce({
      data: { ...googleData(), subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" },
    });
    const newer = await verifyGooglePurchase("new-token");
    release({ data: googleData() });
    expect(await older).toMatchObject({ verificationRevision: 1, status: "active" });
    expect(newer).toMatchObject({ verificationRevision: 2, status: "expired" });
  });

  it("forwards trusted revision/parent and returns actual modules after a stale projection is ignored", async () => {
    const verified = await verifyGooglePurchase("new-token");
    mocks.modules.mockResolvedValue(["drive"]);
    const result = await applyVerifiedPurchase(user, workspace, verified);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mobile_apply_store_contract",
      expect.objectContaining({
        p_previous_external_id: "verified-parent-token",
        p_verification_revision: 1,
      }),
    );
    expect(result.modules).toEqual(["drive"]);
  });

  it("does not accept revision or replacement-parent assertions from a client", () => {
    expect(
      storeVerificationSchema.safeParse({
        workspaceId: workspace,
        provider: "google",
        productId: "business_books",
        purchaseToken: "new-token",
        verificationRevision: 999,
        previousExternalId: "forged-parent",
      }).success,
    ).toBe(false);
  });

  it("fails before provider I/O if a durable revision cannot be allocated", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(verifyGooglePurchase("new-token")).rejects.toThrow("Unable to order");
    expect(mocks.googleRequest).not.toHaveBeenCalled();
  });
});

describe("Google deferred entitlements and acknowledgement", () => {
  const deferredLines = () => [
    {
      productId: "business_books_drive",
      expiryTime: "2099-01-01T00:00:00Z",
      offerDetails: { basePlanId: "monthly" },
      autoRenewingPlan: { autoRenewEnabled: false },
      deferredItemReplacement: { productId: "business_books" },
    },
    {
      productId: "business_books",
      offerDetails: { basePlanId: "annual" },
      autoRenewingPlan: { autoRenewEnabled: true },
    },
  ];

  it("retains the old product on the new token and exposes the confirmed deferred target", async () => {
    mocks.googleRequest.mockResolvedValue({
      data: { ...googleData(), lineItems: deferredLines().reverse() },
    });
    const verified = await verifyGooglePurchase("replacement-token");
    expect(verified).toMatchObject({
      externalId: "replacement-token",
      productId: "business_books_drive",
      basePlanId: "monthly",
      pendingProductId: "business_books",
      pendingBasePlanId: "annual",
      paidThrough: "2099-01-01T00:00:00Z",
      renews: true,
    });
    await applyVerifiedPurchase(user, workspace, verified);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mobile_apply_store_contract",
      expect.objectContaining({
        p_modules: ["books", "drive"],
        p_interval: "monthly",
        p_pending_modules: ["books"],
        p_pending_interval: "annual",
      }),
    );
  });

  it("does not infer current access from a deferred target with a later expiry", async () => {
    const lines = deferredLines();
    mocks.googleRequest.mockResolvedValue({
      data: {
        ...googleData(),
        lineItems: [lines[0], { ...lines[1], expiryTime: "2099-02-01T00:00:00Z" }],
      },
    });
    expect(await verifyGooglePurchase("replacement-token")).toMatchObject({
      productId: "business_books_drive",
      pendingProductId: "business_books",
    });
  });

  it("switches only after the provider gives the target a current expiry and removes the marker", async () => {
    mocks.googleRequest.mockResolvedValue({
      data: {
        ...googleData(),
        lineItems: [
          {
            productId: "business_books_drive",
            expiryTime: "2000-01-01T00:00:00Z",
            offerDetails: { basePlanId: "monthly" },
          },
          {
            productId: "business_books",
            expiryTime: "2099-02-01T00:00:00Z",
            offerDetails: { basePlanId: "annual" },
            autoRenewingPlan: { autoRenewEnabled: true },
          },
        ],
      },
    });
    const verified = await verifyGooglePurchase("replacement-token");
    expect(verified).toMatchObject({ productId: "business_books", basePlanId: "annual" });
    expect(verified.pendingProductId).toBeUndefined();
    await applyVerifiedPurchase(user, workspace, verified);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mobile_apply_store_contract",
      expect.objectContaining({
        p_modules: ["books"],
        p_interval: "annual",
        p_pending_modules: null,
        p_pending_interval: null,
      }),
    );
  });

  it("does not invent the pending interval when only the provider's replacement marker is available", async () => {
    mocks.googleRequest.mockResolvedValue({
      data: { ...googleData(), lineItems: [deferredLines()[0]] },
    });
    const verified = await verifyGooglePurchase("replacement-token");
    await applyVerifiedPurchase(user, workspace, verified);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mobile_apply_store_contract",
      expect.objectContaining({ p_pending_modules: ["books"], p_pending_interval: null }),
    );
  });

  it("rejects an undated future item without granting access", async () => {
    mocks.googleRequest.mockResolvedValue({
      data: { ...googleData(), lineItems: [deferredLines()[1]] },
    });
    await expect(verifyGooglePurchase("replacement-token")).rejects.toMatchObject({
      code: "INVALID_PURCHASE",
    });
  });

  it.each(["SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"])(
    "does not project payment state %s over prior paid coverage",
    async (subscriptionState) => {
      mocks.googleRequest.mockResolvedValue({ data: { ...googleData(), subscriptionState } });
      await expect(verifyGooglePurchase("replacement-token")).rejects.toMatchObject({
        status: 409,
      });
      expect(mocks.rpc).not.toHaveBeenCalledWith("mobile_apply_store_contract", expect.anything());
    },
  );

  it("accepts an active purchase awaiting acknowledgement so native finishing can follow verification", async () => {
    mocks.googleRequest.mockResolvedValue({
      data: { ...googleData(), acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" },
    });
    expect(await verifyGooglePurchase("replacement-token")).toMatchObject({ status: "active" });
  });

  it("returns current and pending store plan fields from the current contract", async () => {
    mocks.billing.mockResolvedValue({
      data: {
        provider: "google",
        status: "active",
        paid_through: "2099-01-01",
        grace_until: null,
        interval: "monthly",
        renews: true,
        pending_modules: ["books"],
        pending_interval: "annual",
      },
      error: null,
    });
    expect(await getMobileBilling(workspace)).toMatchObject({
      interval: "monthly",
      renews: true,
      pendingModules: ["books"],
      pendingInterval: "annual",
    });
  });

  it("preserves the legacy web subscription interval when there is no billing contract", async () => {
    mocks.billing.mockResolvedValue({ data: null, error: null });
    mocks.subscription.mockResolvedValue({
      stripeSubscriptionId: "sub_1",
      billingInterval: "annual",
      status: "active",
    });
    expect(await getMobileBilling(workspace)).toMatchObject({
      provider: "stripe",
      interval: "annual",
      pendingModules: null,
      pendingInterval: null,
    });
  });
});

describe("purchase-sheet preflight", () => {
  const operationId = "33333333-3333-4333-8333-333333333333";
  const body = {
    workspaceId: workspace,
    provider: "google",
    offerKey: "books_monthly",
    operationId,
  };

  it.each(["billing_retry", "on_hold", "paused"])(
    "blocks every purchase sheet during %s and directs recovery",
    async (status) => {
      const provider = status === "billing_retry" ? "apple" : "google";
      mocks.billing.mockResolvedValue({
        data: { provider, status, paid_through: "2000-01-01" },
        error: null,
      });
      mocks.contract.mockResolvedValue({
        data: { owner_user_id: user, external_id: "recoverable" },
        error: null,
      });
      for (const target of ["apple", "google"] as const) {
        expect(await storeCatalog(user, workspace, target)).toMatchObject({
          purchaseAllowed: false,
          currentOfferActive: false,
          googleReplacement: null,
          reason: expect.stringContaining("Fix or cancel"),
        });
      }
    },
  );

  it.each(["revoked", "refunded", "expired"])(
    "permits a provider change for %s despite a future expiry",
    async (status) => {
      mocks.billing.mockResolvedValue({
        data: { provider: "apple", status, paid_through: "2099-01-01", grace_until: "2099-02-01" },
        error: null,
      });
      expect(await storeCatalog(user, workspace, "google")).toMatchObject({
        purchaseAllowed: true,
        currentOfferActive: false,
        googleReplacement: null,
      });
    },
  );

  it.each(["active", "grace", "canceled"])(
    "keeps future %s store coverage exclusive",
    async (status) => {
      mocks.billing.mockResolvedValue({
        data: { provider: "apple", status, paid_through: "2099-01-01" },
        error: null,
      });
      mocks.contract.mockResolvedValue({ data: { owner_user_id: user }, error: null });
      expect(await storeCatalog(user, workspace, "google")).toMatchObject({
        purchaseAllowed: false,
        currentOfferActive: true,
      });
    },
  );

  it.each([
    { status: "active", externalId: "sub_live", paidThrough: null, covered: true },
    { status: "past_due", externalId: "sub_live", paidThrough: null, covered: true },
    {
      status: "incomplete",
      externalId: "checkout:reserved",
      paidThrough: "2099-01-01",
      covered: true,
    },
    {
      status: "incomplete",
      externalId: "checkout:expired",
      paidThrough: "2000-01-01",
      covered: false,
    },
    { status: "canceled", externalId: "sub_ended", paidThrough: "2099-01-01", covered: false },
  ])(
    "honors Stripe status and checkout expiry: $status $externalId",
    async ({ status, externalId, paidThrough, covered }) => {
      mocks.billing.mockResolvedValue({
        data: { provider: "stripe", status, paid_through: paidThrough },
        error: null,
      });
      mocks.contract.mockResolvedValue({ data: { external_id: externalId }, error: null });
      expect(await storeCatalog(user, workspace, "google")).toMatchObject({
        purchaseAllowed: !covered,
        currentOfferActive: covered,
      });
    },
  );

  it("blocks another workspace even after the purchaser's historical store coverage expires", async () => {
    mocks.binding.mockResolvedValue({
      data: { workspace_id: "historical-workspace", provider: "apple" },
      error: null,
    });
    mocks.billing.mockResolvedValue({ data: null, error: null });
    mocks.subscription.mockResolvedValue(null);
    expect(await storeCatalog(user, workspace, "apple")).toMatchObject({
      purchaseAllowed: false,
      binding: { workspaceId: "historical-workspace" },
    });
  });

  it("blocks another provider while a fresh purchase has an unresolved outcome", async () => {
    mocks.billing.mockResolvedValue({ data: null, error: null });
    mocks.subscription.mockResolvedValue(null);
    mocks.intent.mockResolvedValue({
      data: { workspace_id: workspace, provider: "apple", offer_key: "books_monthly" },
      error: null,
    });
    expect(await storeCatalog(user, workspace, "google")).toMatchObject({
      purchaseAllowed: false,
      reason: expect.stringContaining("pending"),
    });
  });

  it("starts the validated offer with a durable client identity and authenticated purchaser", async () => {
    mocks.rpc.mockResolvedValue({ data: operationId, error: null });
    expect(await startStorePurchaseIntent(user, workspace, body)).toEqual({
      intentId: operationId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("mobile_start_store_purchase_intent", {
      p_id: operationId,
      p_user_id: user,
      p_workspace_id: workspace,
      p_provider: "google",
      p_offer_key: "books_monthly",
    });
  });

  it("rejects unknown offers without reserving a purchase", async () => {
    await expect(
      startStorePurchaseIntent(user, workspace, { ...body, offerKey: "invented" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_PRODUCT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("cancels only the caller's specified original workspace intent", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(
      await cancelStorePurchaseIntent(user, workspace, {
        workspaceId: workspace,
        intentId: operationId,
      }),
    ).toEqual({ cancelled: true });
    expect(mocks.rpc).toHaveBeenCalledWith("mobile_cancel_store_purchase_intent", {
      p_id: operationId,
      p_user_id: user,
      p_workspace_id: workspace,
    });
  });

  it("passes the explicit intent and trusted deferred offer to atomic verification", async () => {
    const verified = await verifyGooglePurchase("token");
    await applyVerifiedPurchase(
      user,
      workspace,
      { ...verified, pendingProductId: "business_books_drive", pendingBasePlanId: "annual" },
      operationId,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mobile_apply_store_contract",
      expect.objectContaining({
        p_intent_id: operationId,
        p_pending_product_key: "books_drive_annual",
      }),
    );
  });

  it("uses signed Apple renewal data to match an intent for a scheduled plan change", async () => {
    mocks.appleStatuses.mockResolvedValue({
      data: [
        {
          lastTransactions: [
            { status: 1, signedTransactionInfo: "trusted", signedRenewalInfo: "trusted-renewal" },
          ],
        },
      ],
    });
    mocks.transaction.mockResolvedValue({
      originalTransactionId: "original",
      productId: "com.soletrade.business.books_drive.monthly",
      appAccountToken: user,
      purchaseDate: 1,
      expiresDate: Date.parse("2099-01-01"),
      environment: "Sandbox",
    });
    mocks.renewal.mockResolvedValue({
      autoRenewStatus: 1,
      autoRenewProductId: "com.soletrade.business.books.annual",
    });
    const verified = await verifyApplePurchase({ transactionId: "new" });
    expect(verified.pendingProductId).toBe("com.soletrade.business.books.annual");
    await applyVerifiedPurchase(user, workspace, verified, operationId);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mobile_apply_store_contract",
      expect.objectContaining({
        p_product_key: "books_drive_monthly",
        p_pending_product_key: "books_annual",
        p_intent_id: operationId,
      }),
    );
  });
});
