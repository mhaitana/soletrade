import "server-only";
import { getAdminDb } from "./db";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";

export interface AdminSubscriptionSummary {
  workspaceId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: string;
  billingInterval: "month" | "year" | null;
  anchorModuleKey: string | null;
  addonModuleKeys: string[];
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export async function listWorkspaceSubscriptions(): Promise<AdminSubscriptionSummary[]> {
  await requireAdminContext("view:subscriptions");
  const db = getAdminDb();

  const { data: rows } = await db
    .from("subscriptions")
    .select(
      "workspace_id, stripe_customer_id, stripe_subscription_id, status, billing_interval, anchor_module_key, addon_module_keys, current_period_end, cancel_at_period_end",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (!rows) return [];

  return (
    rows as Array<{
      workspace_id: string;
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      status: string;
      billing_interval: "month" | "year" | null;
      anchor_module_key: string | null;
      addon_module_keys: string[] | null;
      current_period_end: string | null;
      cancel_at_period_end: boolean | null;
    }>
  ).map((row) => ({
    workspaceId: row.workspace_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    billingInterval: row.billing_interval,
    anchorModuleKey: row.anchor_module_key,
    addonModuleKeys: row.addon_module_keys ?? [],
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end) : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
  }));
}

export async function reconcileSubscriptionMetadata(
  workspaceId: string,
  reason: string,
): Promise<void> {
  const ctx = await requireAdminContext("manage:subscriptions");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A reason is required to reconcile subscription state.");
  }

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "billing_admin",
    action: "reconcile_subscription",
    targetType: "subscription",
    targetId: workspaceId,
    workspaceId,
    reason,
  });
}
