import "server-only";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { getDataClient } from "@/server/db/client";
import { branded } from "@/shared/types/ids";
import {
  applyVerifiedPurchase,
  appleConfiguration,
  verifyApplePurchase,
  verifyGooglePurchase,
  type VerifiedStorePurchase,
} from "./billing";
import { MobileApiError } from "./http";

async function processStoreEvent(
  provider: "apple" | "google",
  eventId: string,
  verified: VerifiedStorePurchase,
  attemptAlreadyRecorded = false,
) {
  const db = getDataClient();
  const { error: insertError } = await db.from("billing_events").upsert(
    {
      provider,
      event_id: eventId,
      environment: verified.environment,
      external_id: verified.externalId,
      payload: { productId: verified.productId },
      status: "pending",
    },
    { onConflict: "provider,environment,event_id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error("Could not persist store event");
  const { data: event, error: readError } = await db
    .from("billing_events")
    .select("id,status,attempts")
    .eq("provider", provider)
    .eq("event_id", eventId)
    .eq("environment", verified.environment)
    .single();
  if (readError) throw new Error("Could not read store event");
  if (event.status === "complete") return { received: true };
  const attempts = attemptAlreadyRecorded ? event.attempts : event.attempts + 1;
  if (!attemptAlreadyRecorded) {
    const { error: attemptError } = await db
      .from("billing_events")
      .update({ attempts, updated_at: new Date().toISOString() })
      .eq("id", event.id);
    if (attemptError) throw new Error("Could not record store event attempt");
  }
  const { data: binding, error } = await db
    .from("store_workspace_bindings")
    .select("user_id,workspace_id")
    .eq("provider", provider)
    .eq("external_id", verified.externalId)
    .maybeSingle();
  if (error) throw new Error("Could not resolve store purchase binding");
  // Persist unmatched events before returning. The client purchase verifier establishes
  // the binding; the reconciliation worker retries early notifications afterwards.
  if (!binding) {
    const { error: pendingError } = await db
      .from("billing_events")
      .update({
        status: attempts >= 20 ? "failed" : "pending",
        error_code: "PURCHASE_NOT_BOUND",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    if (pendingError) throw new Error("Could not retain unmatched store event");
    return { received: true, pending: attempts < 20 };
  }
  try {
    await applyVerifiedPurchase(
      branded<"UserId">(binding.user_id),
      branded<"WorkspaceId">(binding.workspace_id),
      verified,
    );
    const { error: finishError } = await db
      .from("billing_events")
      .update({
        status: "complete",
        attempts,
        error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    if (finishError) throw new Error("Could not complete store event");
  } catch (failure) {
    await db
      .from("billing_events")
      .update({
        attempts,
        status: attempts >= 20 ? "failed" : "pending",
        error_code: failure instanceof MobileApiError ? failure.code : "VERIFY_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    throw failure;
  }
  return { received: true };
}

export async function appleStoreNotification(value: unknown) {
  const { signedPayload } = z
    .object({ signedPayload: z.string().min(1).max(100_000) })
    .parse(value);
  const { verifier } = appleConfiguration();
  const notification = await verifier.verifyAndDecodeNotification(signedPayload);
  if (!notification.notificationUUID || !notification.data?.signedTransactionInfo)
    return { received: true };
  const transaction = await verifier.verifyAndDecodeTransaction(
    notification.data.signedTransactionInfo,
  );
  if (!transaction.transactionId)
    throw new MobileApiError("INVALID_NOTIFICATION", "Missing signed transaction.", 422);
  // Provider GET wins over event arrival order, including late refund/cancellation events.
  return processStoreEvent(
    "apple",
    notification.notificationUUID,
    await verifyApplePurchase({ transactionId: transaction.transactionId }),
  );
}

export async function googleStoreNotification(request: Request, value: unknown) {
  const audience = process.env.GOOGLE_PLAY_NOTIFICATION_AUDIENCE;
  const email = process.env.GOOGLE_PLAY_NOTIFICATION_EMAIL;
  if (!audience || !email)
    throw new MobileApiError(
      "STORE_NOT_CONFIGURED",
      "Store notifications are not configured.",
      503,
    );
  const bearer = /^Bearer (.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!bearer)
    throw new MobileApiError("UNAUTHENTICATED", "A verified Pub/Sub identity is required.", 401);
  let payload;
  try {
    payload = (await new OAuth2Client().verifyIdToken({ idToken: bearer, audience })).getPayload();
  } catch {
    throw new MobileApiError("UNAUTHENTICATED", "Invalid Pub/Sub identity.", 401);
  }
  if (!payload?.email_verified || payload.email !== email)
    throw new MobileApiError("UNAUTHENTICATED", "Unexpected Pub/Sub identity.", 401);
  const { message } = z
    .object({
      message: z.object({ messageId: z.string().min(1), data: z.string().min(1).max(100_000) }),
    })
    .parse(value);
  const notification = z
    .object({
      packageName: z.string(),
      subscriptionNotification: z
        .object({ purchaseToken: z.string().min(1).max(40_000) })
        .optional(),
      testNotification: z.unknown().optional(),
    })
    .parse(JSON.parse(Buffer.from(message.data, "base64").toString("utf8")));
  if (notification.packageName !== (process.env.MOBILE_BUNDLE_ID ?? "au.com.soletrade.business"))
    throw new MobileApiError("INVALID_PACKAGE", "Unexpected package name.", 422);
  if (!notification.subscriptionNotification) return { received: true };
  return processStoreEvent(
    "google",
    message.messageId,
    await verifyGooglePurchase(notification.subscriptionNotification.purchaseToken),
  );
}

export async function reconcileStoreContracts() {
  const db = getDataClient();
  const { data, error } = await db
    .from("billing_contracts")
    .select("*")
    .eq("current", true)
    .in("provider", ["apple", "google"])
    .order("last_verification_attempt_at", { nullsFirst: true })
    .order("id")
    .limit(100);
  if (error) throw new Error("Unable to load store contracts");
  let refreshed = 0;
  for (const contract of data ?? []) {
    try {
      // Failed/closed contracts rotate too; otherwise the oldest 100 can block
      // every subsequent contract indefinitely.
      const { error: attemptError } = await db
        .from("billing_contracts")
        .update({ last_verification_attempt_at: new Date().toISOString() })
        .eq("id", contract.id);
      if (attemptError) throw new Error("Unable to record store verification attempt");
      const verified =
        contract.provider === "apple"
          ? await verifyApplePurchase({ transactionId: contract.external_id })
          : await verifyGooglePurchase(contract.external_id);
      if (!contract.owner_user_id) continue;
      await applyVerifiedPurchase(
        branded<"UserId">(contract.owner_user_id),
        branded<"WorkspaceId">(contract.workspace_id),
        verified,
      );
      refreshed++;
    } catch (failure) {
      console.error("Store reconciliation failed", {
        contractId: contract.id,
        kind: failure instanceof Error ? failure.name : "unknown",
      });
    }
  }
  const { data: pending, error: pendingError } = await db
    .from("billing_events")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", 20)
    .order("updated_at")
    .order("id")
    .limit(100);
  if (pendingError) throw new Error("Unable to load pending store events");
  for (const event of pending ?? []) {
    const attempts = event.attempts + 1;
    try {
      // Claim this attempt before provider I/O, so failed verification and
      // unmatched purchases both consume their bounded retry budget.
      const { data: claimed, error: claimError } = await db
        .from("billing_events")
        .update({ attempts, updated_at: new Date().toISOString() })
        .eq("id", event.id)
        .eq("status", "pending")
        .eq("attempts", event.attempts)
        .select("id");
      if (claimError) throw new Error("Unable to claim store event attempt");
      if (!claimed?.length) continue;
      const verified =
        event.provider === "apple"
          ? await verifyApplePurchase({ transactionId: event.external_id })
          : await verifyGooglePurchase(event.external_id);
      await processStoreEvent(event.provider as "apple" | "google", event.event_id, verified, true);
    } catch {
      await db
        .from("billing_events")
        .update({
          status: attempts >= 20 ? "failed" : "pending",
          error_code: "VERIFY_FAILED",
          updated_at: new Date().toISOString(),
        })
        .eq("id", event.id)
        .eq("status", "pending")
        .eq("attempts", attempts);
    }
  }
  return { refreshed };
}
