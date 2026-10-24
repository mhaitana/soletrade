import "server-only";
import { getDataClient } from "@/server/db/client";
import { unwrapMaybe } from "@/server/db/helpers";
import type { WorkspaceId } from "@/shared/types/ids";
export type BillingProvider = "stripe" | "apple" | "google";
export async function getBillingAuthority(workspaceId: WorkspaceId) {
  return unwrapMaybe(
    getDataClient()
      .from("billing_contracts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("current", true)
      .maybeSingle(),
  );
}
export type BillingAuthority = NonNullable<Awaited<ReturnType<typeof getBillingAuthority>>>;
export function isStoreAuthority(
  authority: BillingAuthority | null,
): authority is BillingAuthority & { provider: "apple" | "google" } {
  return authority?.provider === "apple" || authority?.provider === "google";
}
export function hasStoreCoverage(authority: BillingAuthority, now = new Date()): boolean {
  // Billing exclusivity includes recoverable payment obligations, even while
  // module access is suspended. The original store can resume charging.
  if (["billing_retry", "on_hold", "paused"].includes(authority.status)) return true;
  if (["expired", "revoked", "refunded"].includes(authority.status)) return false;
  const dates = [authority.paid_through, authority.grace_until].filter((v): v is string =>
    Boolean(v),
  );
  return dates.length
    ? Math.max(...dates.map((v) => new Date(v).getTime())) > now.getTime()
    : !["canceled", "cancelled"].includes(authority.status);
}
export class BillingProviderError extends Error {
  constructor(provider: string) {
    super(
      `Manage this subscription through ${provider === "apple" ? "Apple App Store" : provider === "google" ? "Google Play" : "its current billing provider"}.`,
    );
    this.name = "BillingProviderError";
  }
}
/** This check also runs in the Stripe I/O layer, so bypassing a web form cannot charge a store-paid workspace. */
export async function assertStripeAuthority(
  workspaceId: WorkspaceId,
  subscriptionId?: string | null,
  options: { allowExpiredStore?: boolean } = {},
) {
  const current = await getBillingAuthority(workspaceId);
  if (isStoreAuthority(current) && !(options.allowExpiredStore && !hasStoreCoverage(current)))
    throw new BillingProviderError(current.provider);
  if (
    current?.provider === "stripe" &&
    subscriptionId &&
    !current.external_id.startsWith("checkout:") &&
    current.external_id !== subscriptionId
  )
    throw new BillingProviderError("stripe");
  return current;
}
export async function acceptsStripeEvent(
  workspaceId: WorkspaceId,
  externalId: string,
  localId: string | null,
  checkout = false,
) {
  const current = await getBillingAuthority(workspaceId);
  if (isStoreAuthority(current)) return false;
  if (!checkout && localId !== externalId) return false;
  if (
    checkout &&
    localId &&
    localId !== externalId &&
    !current?.external_id.startsWith("checkout:")
  )
    return false;
  if (
    current?.provider === "stripe" &&
    current.external_id !== externalId &&
    !current.external_id.startsWith("checkout:")
  )
    return false;
  return true;
}

export async function projectStripeContract(input: {
  workspaceId: WorkspaceId;
  externalId: string;
  modules: string[];
  interval: string;
  status: string;
  paidThrough: string | null;
  renews: boolean;
  checkout?: boolean;
  reservationId?: string | null;
}) {
  const { data, error } = await getDataClient().rpc("mobile_apply_stripe_contract", {
    p_workspace_id: input.workspaceId,
    p_external_id: input.externalId,
    p_modules: input.modules,
    p_interval: input.interval,
    p_status: input.status,
    p_paid_through: input.paidThrough,
    p_renews: input.renews,
    p_checkout: input.checkout ?? false,
    p_reservation_id: input.reservationId ?? null,
  });
  if (error) throw new Error(`Unable to reconcile billing authority: ${error.message}`);
  return data === true;
}
export async function reserveStripeCheckout(workspaceId: WorkspaceId) {
  const reservationId = globalThis.crypto.randomUUID();
  const expiresAt = Math.floor((Date.now() + 35 * 60_000) / 1000);
  const { data, error } = await getDataClient().rpc("mobile_reserve_stripe_checkout", {
    p_workspace_id: workspaceId,
    p_reservation_id: reservationId,
    p_expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (error) throw new Error(`Unable to reserve checkout: ${error.message}`);
  if (!data)
    throw new Error(
      "Another billing purchase or active subscription already covers this workspace. Refresh billing before continuing.",
    );
  return { reservationId, expiresAt };
}
export async function releaseStripeCheckout(workspaceId: WorkspaceId, reservationId: string) {
  const { error } = await getDataClient().rpc("mobile_release_stripe_checkout", {
    p_workspace_id: workspaceId,
    p_reservation_id: reservationId,
  });
  if (error) throw new Error(`Unable to release checkout reservation: ${error.message}`);
}
export async function recordStripeCheckoutSession(
  workspaceId: WorkspaceId,
  reservationId: string,
  sessionId: string,
) {
  const { error } = await getDataClient()
    .from("billing_contracts")
    .update({ product_key: sessionId })
    .eq("workspace_id", workspaceId)
    .eq("external_id", `checkout:${reservationId}`)
    .eq("current", true)
    .eq("status", "incomplete");
  if (error) throw new Error(`Unable to save checkout session: ${error.message}`);
}
export async function changeStripeModule(
  workspaceId: WorkspaceId,
  externalId: string,
  moduleKey: string,
  enabled: boolean,
  itemId?: string | null,
) {
  const { data, error } = await getDataClient().rpc("mobile_change_stripe_module", {
    p_workspace_id: workspaceId,
    p_external_id: externalId,
    p_module_key: moduleKey,
    p_enabled: enabled,
    p_item_id: itemId ?? null,
  });
  if (error) throw new Error(`Unable to update billing module: ${error.message}`);
  if (!data) throw new Error("Billing authority changed. Refresh before changing modules.");
}
