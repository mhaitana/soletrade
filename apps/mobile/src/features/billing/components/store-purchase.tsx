import { Action, NativePage, Note } from "@/components/native-ui";
import { Choice, Group, Toggle } from "@/components/ui";
import {
  reserveStoreIntent,
  resumeStoreIntent,
  shouldCancelStoreIntent,
  uncertainStoreIntent,
  type LocalStoreIntent,
  type StoreFailureSource,
} from "@/features/billing/lib/store-intent";
import {
  canFinishVerifiedPurchase,
  googleChangePreview,
  googlePurchasePayload,
  verifiedPurchaseMessage,
  type GoogleReplacement,
  type StoreChangeTiming,
} from "@/features/billing/lib/store-policy";
import { nativeOperation, readState, writeState } from "@/lib/offline/store";
import type { MobileBilling, MobileFeatureProps, MobileModule } from "@soletrade/contracts";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import {
  deepLinkToSubscriptions,
  finishTransaction,
  getAvailablePurchases,
  restorePurchases as restoreStorePurchases,
  useIAP,
  type ProductSubscription,
  type Purchase,
  type PurchaseAndroid,
} from "expo-iap";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";
interface Offer {
  key: string;
  modules: MobileModule[];
  interval: "monthly" | "annual";
  appleProductId: string;
  googleProductId: string;
  googleBasePlanId: string;
  targetPriceCents: number;
}
interface Catalog {
  offers: Offer[];
  billing: MobileBilling;
  purchaseAllowed: boolean;
  currentOfferKey?: string | null;
  currentOfferActive?: boolean;
  reason?: string;
  binding: { workspaceId: string } | null;
  googleReplacement?: GoogleReplacement | null;
}
interface Intent extends LocalStoreIntent {
  userId: string;
  workspaceId: string;
  operationId: string;
  productId: string;
  basePlanId?: string;
  timing?: StoreChangeTiming;
  previousProductId?: string;
  requestedModules?: MobileModule[];
}
function googleOffer(product: ProductSubscription | undefined, offer: Offer) {
  return product?.platform === "android"
    ? product.subscriptionOffers.find(
        (item) => item.basePlanIdAndroid === offer.googleBasePlanId && item.offerTokenAndroid,
      )
    : undefined;
}
export function StorePurchaseScreen(props: MobileFeatureProps) {
  return <StorePurchase key={`${props.userId}:${props.workspaceId}`} {...props} />;
}
function StorePurchase(props: MobileFeatureProps) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<{
    modules: MobileModule[];
    interval: "monthly" | "annual";
  } | null>(null);
  const currentOffer = catalog?.offers.find((offer) => offer.key === catalog.currentOfferKey);
  const selectedModules: MobileModule[] = selection?.modules ?? currentOffer?.modules ?? ["books"];
  const interval = selection?.interval ?? currentOffer?.interval ?? "monthly";
  const verifyRef = useRef<(purchase: Purchase) => Promise<void>>(async () => {}),
    processing = useRef(new Set<string>()),
    intentRef = useRef<Intent | null>(null),
    openingPurchase = useRef(false),
    failureRef = useRef<(cause: unknown, source: StoreFailureSource) => Promise<void>>(
      async () => {},
    ),
    cancelling = useRef(new Set<string>()),
    purchaseObserved = useRef(false);
  const provider = Platform.OS === "ios" ? "apple" : "google";
  const { request, workspaceId } = props;
  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      if (purchase.purchaseState === "purchased") {
        purchaseObserved.current = true;
        if (intentRef.current) intentRef.current = { ...intentRef.current, phase: "purchased" };
      }
      void verifyRef.current(purchase).catch((cause) => failureRef.current(cause, "verification"));
    },
    onPurchaseError: (cause) => {
      void failureRef.current(cause, "provider");
    },
    onError: (cause) => {
      void failureRef.current(cause, "unknown");
    },
  });
  const persistIntent = async (value: Intent) => {
    if (value.userId !== props.userId || value.workspaceId !== props.workspaceId)
      throw new Error("This purchase belongs to its original account and workspace.");
    await writeState(`store-intent:${props.userId}:${value.provider}:${value.productId}`, value);
    await writeState(
      `store-active-intent:${props.userId}:${value.provider}:${props.workspaceId}`,
      value,
    );
    intentRef.current = value;
  };
  useEffect(() => {
    failureRef.current = async (cause, source) => {
      const value = cause as { code?: unknown; message?: string; productId?: string };
      const detail = value?.message ?? String(cause);
      const intent =
        intentRef.current ??
        (await readState<Intent>(
          `store-active-intent:${props.userId}:${provider}:${props.workspaceId}`,
        ));
      setBusy(false);
      openingPurchase.current = false;
      if (
        intent &&
        !purchaseObserved.current &&
        shouldCancelStoreIntent(intent, source, value?.code) &&
        (!value.productId || value.productId === intent.productId)
      ) {
        if (cancelling.current.has(intent.intentId!)) return;
        cancelling.current.add(intent.intentId!);
        try {
          await props.request("/billing/store/intent/cancel", {
            method: "POST",
            body: { workspaceId: props.workspaceId, intentId: intent.intentId },
            idempotencyKey: await nativeOperation(props.userId, `store-cancel:${intent.intentId}`),
          });
          await persistIntent({ ...intent, phase: "canceled" });
          setError("");
          setMessage("The store confirmed cancellation and the purchase reservation was released.");
        } catch (error) {
          await persistIntent(uncertainStoreIntent(intent)).catch(() => undefined);
          setError(
            `The store reported cancellation, but reservation cleanup could not be confirmed. Resume or restore this original purchase before selecting another plan. ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          cancelling.current.delete(intent.intentId!);
        }
        return;
      }
      if (intent?.offerKey && intent.phase !== "verified" && intent.phase !== "canceled") {
        await persistIntent(uncertainStoreIntent(intent)).catch(() => undefined);
        setError(
          `${detail} The purchase reservation is retained. Resume this plan or restore purchases before choosing another plan or workspace.`,
        );
      } else setError(detail);
    };
  });
  const loadCatalog = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await props.request<Catalog>(
        `/billing/store/catalog?workspaceId=${encodeURIComponent(props.workspaceId)}&provider=${provider}`,
      );
      setCatalog(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let live = true;
    void request<Catalog>(
      `/billing/store/catalog?workspaceId=${encodeURIComponent(workspaceId)}&provider=${provider}`,
    )
      .then((data) => {
        if (live) setCatalog(data);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [request, workspaceId, provider]);
  const { fetchProducts, connected } = iap;
  useEffect(() => {
    if (!catalog || !connected) return;
    const skus = [
      ...new Set(
        catalog.offers.map((offer) =>
          provider === "apple" ? offer.appleProductId : offer.googleProductId,
        ),
      ),
    ];
    if (skus.length)
      void fetchProducts({ skus, type: "subs" }).catch((cause) => setError(String(cause)));
  }, [catalog, connected, provider, fetchProducts]);
  useEffect(() => {
    verifyRef.current = async (purchase: Purchase) => {
      const key = `${purchase.store}:${purchase.id}`;
      if (processing.current.has(key)) return;
      processing.current.add(key);
      setBusy(true);
      setError("");
      try {
        if (purchase.purchaseState !== "purchased")
          throw new Error(
            "This purchase is pending. Access will update after the store confirms payment.",
          );
        const activeIntent =
          intentRef.current ??
          (await readState<Intent>(
            `store-active-intent:${props.userId}:${provider}:${props.workspaceId}`,
          ));
        const related =
          activeIntent &&
          (activeIntent.productId === purchase.productId ||
            purchase.ids?.includes(activeIntent.productId) ||
            (provider === "google" &&
              activeIntent.timing === "renewal" &&
              activeIntent.previousProductId === purchase.productId));
        const intent = related
          ? activeIntent
          : await readState<Intent>(
              `store-intent:${props.userId}:${provider}:${purchase.productId}`,
            );
        if (intent && (intent.userId !== props.userId || intent.workspaceId !== props.workspaceId))
          throw new Error(
            "This purchase belongs to its original account and workspace. Switch to that workspace to restore.",
          );
        if (catalog?.binding && catalog.binding.workspaceId !== props.workspaceId)
          throw new Error("Your store subscription is already bound to another workspace.");
        if (intent?.offerKey && intent.phase !== "verified")
          await persistIntent({ ...intent, phase: "purchased" });
        if (!purchase.purchaseToken)
          throw new Error(
            "The store did not provide verification data. Restore purchases or contact support; do not purchase again.",
          );
        const result = await props.request<{ billing: MobileBilling; modules: MobileModule[] }>(
          "/billing/store/verify",
          {
            method: "POST",
            body: {
              workspaceId: props.workspaceId,
              provider,
              productId: purchase.productId,
              transactionId: purchase.id,
              ...(intent?.intentId ? { intentId: intent.intentId } : {}),
              ...(provider === "apple"
                ? { signedTransactionInfo: purchase.purchaseToken }
                : {
                    purchaseToken: purchase.purchaseToken,
                    basePlanId: intent?.basePlanId ?? purchase.currentPlanId,
                  }),
            },
            idempotencyKey:
              intent?.operationId ??
              (await nativeOperation(props.userId, `restore:${provider}:${purchase.id}`)),
          },
        );
        if (!canFinishVerifiedPurchase(result.billing))
          throw new Error(
            `The server reports subscription status ${result.billing.status}. Access was not granted.`,
          );
        if (intent?.offerKey) await persistIntent({ ...intent, phase: "verified" });
        await finishTransaction({ purchase, isConsumable: false });
        setMessage(
          verifiedPurchaseMessage(
            intent?.timing,
            intent?.requestedModules,
            result.modules,
            result.billing.pendingModules,
          ),
        );
        props.onSaved?.();
        await loadCatalog();
      } finally {
        processing.current.delete(key);
        setBusy(false);
        openingPurchase.current = false;
      }
    };
  });
  const buy = async (offer: Offer) => {
    if (busy || openingPurchase.current) return;
    openingPurchase.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let storeOpened = false;
    try {
      if (!catalog?.purchaseAllowed)
        throw new Error(catalog?.reason ?? "This workspace cannot start a store purchase.");
      // Recheck provider authority immediately before opening the native payment sheet.
      const current = await props.request<Catalog>(
        `/billing/store/catalog?workspaceId=${encodeURIComponent(props.workspaceId)}&provider=${provider}`,
      );
      if (!current.purchaseAllowed)
        throw new Error(
          current.reason ?? "Billing authority changed. Refresh billing before purchasing.",
        );
      if (current.binding && current.binding.workspaceId !== props.workspaceId)
        throw new Error("Your store subscription belongs to its original workspace.");
      const productId = provider === "apple" ? offer.appleProductId : offer.googleProductId;
      const product = iap.subscriptions.find((item) => item.id === productId);
      if (!product)
        throw new Error("This product is unavailable from the store. No charge has been started.");
      const storeOffer = googleOffer(product, offer);
      if (provider === "google" && !storeOffer?.offerTokenAndroid)
        throw new Error("This Google base plan is not available. Refresh store products.");
      const account = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          props.userId,
        ),
        profile = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          props.workspaceId,
        );
      const google =
        provider === "google"
          ? googlePurchasePayload({
              accountHash: account,
              profileHash: profile,
              offerToken: storeOffer!.offerTokenAndroid!,
              billing: current.billing,
              replacement: current.googleReplacement,
              availablePurchases: (await getAvailablePurchases()).filter(
                (purchase): purchase is PurchaseAndroid => purchase.store === "google",
              ),
              target: { productId, basePlanId: offer.googleBasePlanId, modules: offer.modules },
            })
          : null;
      const intent: Intent = {
        userId: props.userId,
        workspaceId: props.workspaceId,
        operationId: Crypto.randomUUID(),
        provider,
        offerKey: offer.key,
        phase: "prepared",
        launchedLocally: false,
        productId,
        basePlanId: offer.googleBasePlanId,
        timing: google?.timing,
        previousProductId: google ? current.googleReplacement?.productId : undefined,
        requestedModules: offer.modules,
      };
      const active = await readState<Intent>(
          `store-active-intent:${props.userId}:${provider}:${props.workspaceId}`,
        ),
        byProduct = await readState<Intent>(
          `store-intent:${props.userId}:${provider}:${productId}`,
        );
      const previous =
        active?.offerKey && active.phase !== "verified" && active.phase !== "canceled"
          ? active
          : byProduct?.offerKey
            ? byProduct
            : null;
      const resumed = resumeStoreIntent(previous, intent);
      if (resumed.launchedLocally || ["opened", "uncertain", "purchased"].includes(resumed.phase))
        throw new Error(
          "This purchase is awaiting verification. Restore it before opening another store payment sheet.",
        );
      const reserved = await reserveStoreIntent(resumed, props.request, persistIntent);
      purchaseObserved.current = false;
      await persistIntent({ ...reserved, phase: "opened", launchedLocally: true });
      storeOpened = true;
      await iap.requestPurchase({
        type: "subs",
        request: {
          apple: {
            sku: productId,
            appAccountToken: props.userId,
            andDangerouslyFinishTransactionAutomatically: false,
          },
          ...(google ? { google: google.google } : {}),
        },
      });
      // Store completion is event driven. The success/error callback owns busy from here.
    } catch (cause) {
      await failureRef.current(cause, storeOpened ? "provider" : "preflight");
    }
  };
  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await restoreStorePurchases();
      const purchases = await getAvailablePurchases();
      if (!purchases.length) {
        setMessage("No purchases were found for this store account.");
        return;
      }
      for (const purchase of purchases) await verifyRef.current(purchase);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <NativePage title="Workspace subscription">
      <Note>
        Subscriptions renew through {provider === "apple" ? "the App Store" : "Google Play"}. One
        store-funded workspace remains the original workspace across its purchase history. Use web
        billing for additional workspaces. Current provider coverage must end before switching
        billing providers in that original workspace.
      </Note>
      {loading && <ActivityIndicator accessibilityLabel="Loading catalog" />}
      {error && <Note error>{error}</Note>}
      {message && <Note>{message}</Note>}
      {busy && <ActivityIndicator accessibilityLabel="Waiting for store or verification" />}
      {catalog && (
        <>
          <Note>
            Current billing: {catalog.billing.provider ?? "none"} · {catalog.billing.status}
            {catalog.billing.paidThrough
              ? ` · through ${new Date(catalog.billing.paidThrough).toLocaleDateString()}`
              : ""}
          </Note>
          {!catalog.purchaseAllowed && (
            <Note>
              {catalog.reason ?? "New store purchases are unavailable for this workspace."}
            </Note>
          )}
          {catalog.offers.length === 0 && (
            <Note>No configured subscription products are available.</Note>
          )}
          <Group title="Choose what your business needs">
            {(["invoices", "quotes", "books", "drive"] as const).map((moduleKey) => (
              <Toggle
                key={moduleKey}
                label={
                  moduleKey === "books"
                    ? "Books"
                    : moduleKey === "drive"
                      ? "Drive"
                      : moduleKey === "invoices"
                        ? "Invoices"
                        : "Quotes"
                }
                value={selectedModules.includes(moduleKey)}
                onChange={(enabled) => {
                  if (busy) return;
                  setSelection({
                    modules: enabled
                      ? [...new Set<MobileModule>([...selectedModules, moduleKey])]
                      : (selectedModules.filter((key) => key !== moduleKey) as MobileModule[]),
                    interval,
                  });
                }}
              />
            ))}
            <Choice
              label="Billing period"
              value={interval}
              options={[
                { label: "Monthly", value: "monthly" },
                { label: "Annually", value: "annual" },
              ]}
              onChange={(value) => {
                if (!busy)
                  setSelection({
                    modules: selectedModules as MobileModule[],
                    interval: value as "monthly" | "annual",
                  });
              }}
            />
          </Group>
          {selectedModules.length === 0 && (
            <Note>Select at least one module to see its store price.</Note>
          )}
          {catalog.offers
            .filter(
              (offer) =>
                offer.interval === interval &&
                offer.modules.length === selectedModules.length &&
                offer.modules.every((key) => selectedModules.includes(key)),
            )
            .map((offer) => {
              const id = provider === "apple" ? offer.appleProductId : offer.googleProductId;
              const product = iap.subscriptions.find((item) => item.id === id);
              const details = googleOffer(product, offer);
              const price = provider === "apple" ? product?.displayPrice : details?.displayPrice;
              const currentPlan =
                catalog.billing.provider === provider &&
                catalog.currentOfferActive === true &&
                (catalog.currentOfferKey === offer.key ||
                  (provider === "google" &&
                    catalog.googleReplacement?.productId === offer.googleProductId &&
                    catalog.googleReplacement.basePlanId === offer.googleBasePlanId));
              const changePreview =
                provider === "google"
                  ? googleChangePreview(catalog.googleReplacement, {
                      productId: offer.googleProductId,
                      basePlanId: offer.googleBasePlanId,
                      modules: offer.modules,
                    })
                  : "The App Store confirms the effective plan, billing adjustment and renewal date before payment.";
              return (
                <View
                  key={offer.key}
                  style={{
                    gap: 10,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: "#8495a4",
                    borderRadius: 12,
                  }}
                >
                  <Note>
                    {offer.modules.join(" + ")} · {offer.interval}
                  </Note>
                  <Note>{price ?? "Price unavailable — product not returned by store"}</Note>
                  <Note>{changePreview}</Note>
                  <Action
                    title={`${currentPlan ? "Current plan" : catalog.billing.provider === provider ? "Change to" : "Subscribe"} ${offer.interval}${price ? ` · ${price}` : ""}`}
                    disabled={
                      busy || !iap.connected || !price || !catalog.purchaseAllowed || currentPlan
                    }
                    onPress={() => void buy(offer)}
                  />
                </View>
              );
            })}
        </>
      )}
      <Action
        title="Refresh catalog & store prices"
        disabled={busy}
        onPress={() => void loadCatalog()}
      />
      <Action
        title="Restore purchases & verify workspace binding"
        disabled={busy || !iap.connected}
        onPress={() => void restore()}
      />
      <Action
        title="Manage renewal or cancellation in the store"
        disabled={busy || !iap.connected}
        onPress={() => {
          void (async () => {
            try {
              if (provider === "apple") await deepLinkToSubscriptions({});
              else {
                const purchases = await getAvailablePurchases();
                const subscription = purchases.find((item) =>
                  catalog?.offers.some((offer) => offer.googleProductId === item.productId),
                );
                const productId = catalog?.googleReplacement?.productId ?? subscription?.productId;
                const packageName = Constants.expoConfig?.android?.package;
                if (!productId || !packageName)
                  throw new Error(
                    "No active subscription was found for this store account. Open Google Play → Payments & subscriptions → Subscriptions.",
                  );
                await deepLinkToSubscriptions({
                  skuAndroid: productId,
                  packageNameAndroid: packageName,
                });
              }
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          })();
        }}
      />
      <Note>
        {iap.connected
          ? "Connected to the native store."
          : "Store not connected. Use a native development or store build with configured products."}{" "}
        Provider prices are localized by the store. No entitlement is granted until server
        verification succeeds. If verification fails, the transaction remains unfinished for retry.
      </Note>
    </NativePage>
  );
}
