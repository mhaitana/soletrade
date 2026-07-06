import "server-only";
import { and, eq, isNull, isNotNull, lte } from "drizzle-orm";
import { getDb } from "@/server/db";
import { moduleInstallations } from "@/server/db/schema";
import { MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
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
  const db = getDb();
  const rows = await db
    .select({
      moduleKey: moduleInstallations.moduleKey,
      status: moduleInstallations.status,
      cancelledAt: moduleInstallations.cancelledAt,
    })
    .from(moduleInstallations)
    .where(
      and(
        eq(moduleInstallations.workspaceId, workspaceId),
        isNull(moduleInstallations.cancelledAt),
      ),
    );
  return resolveActiveModules(rows);
}

export async function isModuleEnabled(workspaceId: WorkspaceId, key: ModuleKey): Promise<boolean> {
  const installed = await getInstalledModules(workspaceId);
  return installed.includes(key);
}

/** Throw if a module isn't enabled — used to gate module routes/actions. */
export async function assertModuleEnabled(workspaceId: WorkspaceId, key: ModuleKey): Promise<void> {
  if (!(await isModuleEnabled(workspaceId, key))) {
    throw new ModuleNotEnabledError(key);
  }
}

/**
 * Enable a module for a workspace. Inserts/upserts the installation row. 4b adds
 * an optional `stripeSubscriptionItemId` — when provided (the 4b orchestrator
 * path), it is written on insert AND on re-enable (overwriting a stale item id
 * from a prior cycle). When omitted (legacy/test/seed path), the column is
 * untouched on re-enable, preserving backward compatibility.
 *
 * `actorId` is optional so the webhook reconcile path
 * (`reconcileFromCheckoutSession` on `checkout.session.completed`) can call this
 * with no user actor — `publishEvent`/`writeAudit` both accept an undefined
 * `actorUserId`. Existing callers passing `ctx.user.id` are unaffected.
 */
export async function enableModule(
  workspaceId: WorkspaceId,
  key: ModuleKey,
  actorId?: UserId,
  stripeSubscriptionItemId?: string,
): Promise<void> {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const db = getDb();
  await db
    .insert(moduleInstallations)
    .values({
      workspaceId,
      moduleKey: key,
      status: "active",
      ...(stripeSubscriptionItemId ? { stripeSubscriptionItemId } : {}),
    })
    .onConflictDoUpdate({
      target: [moduleInstallations.workspaceId, moduleInstallations.moduleKey],
      set: {
        status: "active",
        cancelledAt: null,
        updatedAt: new Date(),
        ...(stripeSubscriptionItemId ? { stripeSubscriptionItemId } : {}),
      },
    });
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
 * (`markCanceled` on `subscription.deleted`) can call this with no user actor —
 * `publishEvent`/`writeAudit` both accept an undefined `actorUserId`. Existing
 * callers passing `ctx.user.id` are unaffected. The `stripeSubscriptionItemId`
 * column is NOT nulled (per brief — the row retains the now-deleted item id).
 */
export async function disableModule(
  workspaceId: WorkspaceId,
  key: ModuleKey,
  actorId?: UserId,
): Promise<void> {
  if (!MODULE_KEYS.includes(key)) throw new Error(`Unknown module key: ${key}`);
  const db = getDb();
  await db
    .update(moduleInstallations)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(moduleInstallations.workspaceId, workspaceId),
        eq(moduleInstallations.moduleKey, key),
        isNull(moduleInstallations.cancelledAt),
      ),
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
 * installation row WITHOUT disabling it — the module stays billable and accessible
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
  const db = getDb();
  await db
    .update(moduleInstallations)
    .set({ pendingCancellationAt: effectiveAt, updatedAt: new Date() })
    .where(
      and(
        eq(moduleInstallations.workspaceId, workspaceId),
        eq(moduleInstallations.moduleKey, key),
        isNull(moduleInstallations.cancelledAt),
      ),
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
  const db = getDb();
  await db
    .update(moduleInstallations)
    .set({ pendingCancellationAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(moduleInstallations.workspaceId, workspaceId),
        eq(moduleInstallations.moduleKey, key),
        isNull(moduleInstallations.cancelledAt),
      ),
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
  const db = getDb();
  return db
    .select({
      workspaceId: moduleInstallations.workspaceId,
      moduleKey: moduleInstallations.moduleKey,
      stripeSubscriptionItemId: moduleInstallations.stripeSubscriptionItemId,
    })
    .from(moduleInstallations)
    .where(
      and(
        eq(moduleInstallations.status, "active"),
        isNull(moduleInstallations.cancelledAt),
        isNotNull(moduleInstallations.pendingCancellationAt),
        lte(moduleInstallations.pendingCancellationAt, now),
      ),
    );
}
