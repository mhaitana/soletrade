import "server-only";
import type { MobileBilling } from "@soletrade/contracts";
import type { WorkspaceId } from "@/types/ids";
import { getDataClient } from "@/server/infrastructure/db/client";
import { getSubscription } from "@/server/foundation/billing/subscriptions";

export async function getBillingState(workspaceId: WorkspaceId): Promise<MobileBilling> {
  const { data, error } = await getDataClient()
    .from("billing_contracts")
    .select(
      "provider,status,paid_through,grace_until,interval,renews,pending_modules,pending_interval",
    )
    .eq("workspace_id", workspaceId)
    .eq("current", true)
    .maybeSingle();
  if (error) throw new Error("Unable to load billing authority");
  if (data)
    return {
      provider: data.provider as MobileBilling["provider"],
      status: data.status,
      interval: data.interval === "monthly" || data.interval === "annual" ? data.interval : null,
      renews: data.renews,
      pendingModules: data.pending_modules as MobileBilling["pendingModules"],
      pendingInterval:
        data.pending_interval === "monthly" || data.pending_interval === "annual"
          ? data.pending_interval
          : null,
      paidThrough:
        data.grace_until && (!data.paid_through || data.grace_until > data.paid_through)
          ? data.grace_until
          : data.paid_through,
    };
  const sub = await getSubscription(workspaceId);
  return {
    provider: sub?.stripeSubscriptionId ? "stripe" : null,
    status: sub?.status ?? "incomplete",
    paidThrough: null,
    interval: sub?.billingInterval ?? null,
    pendingModules: null,
    pendingInterval: null,
  };
}
