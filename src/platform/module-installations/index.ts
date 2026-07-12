import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, unwrap, unwrapVoid } from "@/server/db/helpers";
import { MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";
import { branded, type UserId, type WorkspaceId } from "@/shared/types/ids";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";

export class ModuleNotEnabledError extends Error {
  readonly moduleKey: ModuleKey;
  constructor(moduleKey: ModuleKey) {
    super(`Module "${moduleKey}" is not enabled for this workspace.`);
    this.name = "ModuleNotEnabledError";
    this.moduleKey = moduleKey;
  }
}

/** Pure helper: derive the set of active module keys from raw installation rows. */
export function resolveActiveModules(
  rows: { moduleKey: ModuleKey; status: "active" | "cancelled"; cancelledAt: Date | null }[],
): ModuleKey[] {
  return rows
    .filter((r) => r.status === "active" && r.cancelledAt === null)
    .map((r) => r.moduleKey);
}

/** List active (installed) modules for a workspace. */
export async function getInstalledModules(workspaceId: WorkspaceId): Promise<ModuleKey[]> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("module_installations")
      .select("module_key, status, cancelled_at")
      .eq("workspace_id", workspaceId)
      .is("cancelled_at", null),
  );
  return resolveActiveModules(
    rows.map((r) => ({
      moduleKey: r.module_key,
      status: r.status,
      cancelledAt: r.cancelled_at ? parsePgTimestamp(r.cancelled_at) : null,
    })),
  );
}

export async function isModuleEnabled(workspaceId: WorkspaceId, key: ModuleKey): Promise<boolean> {
  const installed = await getInstalledModules(workspaceId);
  return installed.includes(key);
}

/** Throw if a module isn't enabled - used to gate module routes/actions. */
export async function assertModuleEnabled(workspaceId: WorkspaceId, key: ModuleKey): Promise<void> {
  if (!(await isModuleEnabled(workspaceId, key))) {
    throw new ModuleNotEnabledError(key);
  }
}

/**
 * Full installation rows for a workspace (active rows only - `cancelledAt` null). Includes
 * `pendingCancellationAt` so the modules page can surface "Cancels on {date}" + an undo affordance
 * for keep-until-end scheduled cancellations (Wave 4). The lighter `getInstalledModules` returns
 * just the keys; this returns the full row for the loader.
 */
export async function getModuleInstallations(workspaceId: WorkspaceId): Promise<
  Array<{
    moduleKey: ModuleKey;
    status: "active" | "cancelled";
    pendingCancellationAt: Date | null;
    cancelledAt: Date | null;
  }>
> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("module_installations")
      .select("module_key, status, pending_cancellation_at, cancelled_at")
      .eq("workspace_id", workspaceId)
      .is("cancelled_at", null),
  );
  return rows.map((r) => ({
    moduleKey: r.module_key,
    status: r.status,
    pendingCancellationAt: r.pending_cancellation_at
      ? parsePgTimestamp(r.pending_cancellation_at)
      : null,
    cancelledAt: r.cancelled_at ? parsePgTimestamp(r.cancelled_at) : null,
  }));
}

/**
 * Enable a module for a workspace. Inserts/upserts the installation row. 4b adds
 * an optional `stripeSubscriptionItemId` - when provided (the 4b orchestrator
 * path), it is written on insert AND on re-enable (overwriting a stale item id
 * from a prior cycle). When omitted (legacy/test/seed path), the column is
 * untouched on re-enable, preserving backward compatibility.
 *
 * `actorId` is optional so the webhook reconcile path
 * (`reconcileFromCheckoutSession` on `checkout.session.completed`) can call this
 * with no user actor - `publishEvent`/`writeAudit` both accept an undefined
 * `actorUserId`. Existing callers passing `ctx.user.id` are unaffected.
 */
export async function enableModule(
  workspaceId: WorkspaceId,
  key: ModuleKey,
  actorId?: UserId,
  stripeSubscriptionItemId?: string,
): Promise<void> {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const supabase = getDataClient();
  // PostgREST `.upsert` updates only payload columns on conflict. Including
  // cancelled_at:null clears it on re-enable; omitting stripe_subscription_item_id
  // when not supplied leaves the prior value untouched (backward-compat). The
  // composite unique (workspace_id, module_key) is the conflict target.
  const payload: {
    workspace_id: WorkspaceId;
    module_key: ModuleKey;
    status: "active";
    cancelled_at: null;
    updated_at: string;
    stripe_subscription_item_id?: string;
  } = {
    workspace_id: workspaceId,
    module_key: key,
    status: "active",
    cancelled_at: null,
    updated_at: new Date().toISOString(),
  };
  if (stripeSubscriptionItemId) payload.stripe_subscription_item_id = stripeSubscriptionItemId;
  await unwrapVoid(
    supabase
      .from("module_installations")
      .upsert(payload, { onConflict: "workspace_id,module_key" }),
  );
  await publishEvent({
    type: "ModuleEnabled",
    workspaceId,
    actorUserId: actorId,
    entityType: "module",
    entityId: key,
    metadata: { moduleKey: key },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "module.enable",
    targetType: "module",
    targetId: key,
    metadata: { moduleKey: key },
  });
}

/**
 * Disable (cancel) a module. `actorId` is optional so the webhook cascade
 * (`markCanceled` on `subscription.deleted`) can call this with no user actor -
 * `publishEvent`/`writeAudit` both accept an undefined `actorUserId`. Existing
 * callers passing `ctx.user.id` are unaffected. The `stripeSubscriptionItemId`
 * column is NOT nulled (per brief - the row retains the now-deleted item id).
 */
export async function disableModule(
  workspaceId: WorkspaceId,
  key: ModuleKey,
  actorId?: UserId,
): Promise<void> {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const supabase = getDataClient();
  const nowIso = new Date().toISOString();
  await unwrapVoid(
    supabase
      .from("module_installations")
      .update({ status: "cancelled", cancelled_at: nowIso, updated_at: nowIso })
      .eq("workspace_id", workspaceId)
      .eq("module_key", key)
      .is("cancelled_at", null),
  );
  await publishEvent({
    type: "ModuleDisabled",
    workspaceId,
    actorUserId: actorId,
    entityType: "module",
    entityId: key,
    metadata: { moduleKey: key },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "module.disable",
    targetType: "module",
    targetId: key,
    metadata: { moduleKey: key },
  });
}

/**
 * Schedule a module to run until `effectiveAt` then cancel (Wave 1 cancellation engine,
 * brief §10.6 Branch A "keep-until-end"). Sets `pendingCancellationAt` on the active
 * installation row WITHOUT disabling it - the module stays billable and accessible
 * until the `module-cancel-finalize` cron picks it up at `effectiveAt`. Idempotent:
 * re-scheduling the same module updates the timestamp. Does NOT touch Stripe; the
 * finalize step deletes the subscription item when the timestamp lapses.
 */
export async function scheduleModuleCancellation(
  workspaceId: WorkspaceId,
  key: ModuleKey,
  effectiveAt: Date,
  actorId?: UserId,
): Promise<void> {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("module_installations")
      .update({
        pending_cancellation_at: effectiveAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("module_key", key)
      .is("cancelled_at", null),
  );
  await publishEvent({
    type: "ModuleCancelled",
    workspaceId,
    actorUserId: actorId,
    entityType: "module",
    entityId: key,
    metadata: {
      moduleKey: key,
      option: "keep_until_end_of_cycle",
      effectiveAt: effectiveAt.toISOString(),
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "module.cancel.scheduled",
    targetType: "module",
    targetId: key,
    metadata: { moduleKey: key, effectiveAt: effectiveAt.toISOString() },
  });
}

/**
 * Clear a pending end-of-cycle cancellation (e.g. if the user re-enables the module
 * before the period ends). Nulls `pendingCancellationAt` on the active row.
 */
export async function clearPendingModuleCancellation(
  workspaceId: WorkspaceId,
  key: ModuleKey,
): Promise<void> {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("module_installations")
      .update({ pending_cancellation_at: null, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("module_key", key)
      .is("cancelled_at", null),
  );
}

/**
 * Select installation rows whose keep-until-end cancellation has lapsed and not yet been
 * finalized (`status='active'`, `cancelledAt` null, `pendingCancellationAt <= now`). Used
 * by the `module-cancel-finalize` cron runner. Returns the stored Stripe item id so the
 * runner can delete the subscription item without re-reading the row.
 */
export async function listPendingCancellationsDue(
  now: Date,
): Promise<
  Array<{ workspaceId: WorkspaceId; moduleKey: ModuleKey; stripeSubscriptionItemId: string | null }>
> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("module_installations")
      .select("workspace_id, module_key, stripe_subscription_item_id")
      .eq("status", "active")
      .is("cancelled_at", null)
      .not("pending_cancellation_at", "is", null)
      .lte("pending_cancellation_at", now.toISOString()),
  );
  return rows.map((r) => ({
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    moduleKey: r.module_key,
    stripeSubscriptionItemId: r.stripe_subscription_item_id,
  }));
}
