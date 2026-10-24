"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assertStripeAuthority,
  getBillingAuthority,
  isStoreAuthority,
  BillingProviderError,
} from "@/platform/billing/authority";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import {
  assertModuleEnabled,
  clearPendingModuleCancellation,
  getInstalledModules,
  getModuleInstallations,
  resolveActiveModules,
} from "@/platform/module-installations";
import { ensureSubscription, getSubscription } from "@/platform/billing/subscriptions";
import {
  addModuleToSubscription,
  removeModuleFromSubscription,
  BillingNotStartedError,
} from "@/platform/billing/modules";
import { moduleChargeCents, formatCents, type Interval } from "@/platform/billing/pricing";
import { getCancellationOptions, type CancellationPreview } from "@/platform/billing/cancellation";
import { MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";

const moduleKeySchema = z.enum(MODULE_KEYS);
const forbid = (msg = "You don't have permission to manage modules.") => ({
  ok: false as const,
  error: msg,
});

const START_BILLING_MSG = "Start billing to enable modules.";

export type EnableModuleResult = { ok: true; moduleKey: ModuleKey } | { ok: false; error: string };

export async function enableModuleAction(input: unknown): Promise<EnableModuleResult> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:module")).ok) return forbid();

  try {
    await assertStripeAuthority(ctx.workspaceId);
    // A workspace without active billing can't add paid modules - surface a
    // start-billing prompt instead of hitting the orchestrator (which would
    // throw BillingNotStartedError anyway). `ensureSubscription` lazily creates
    // the unbilled row if the WorkspaceCreated subscriber hasn't run yet.
    const sub = await ensureSubscription(ctx.workspaceId);
    if (sub.stripeSubscriptionId == null || sub.status !== "active") {
      return { ok: false, error: START_BILLING_MSG };
    }

    await addModuleToSubscription(ctx.workspaceId, parsed.data, ctx.user.id);
    revalidatePath("/", "layout");
    return { ok: true, moduleKey: parsed.data };
  } catch (err) {
    if (err instanceof BillingNotStartedError) return { ok: false, error: START_BILLING_MSG };
    return { ok: false, error: err instanceof Error ? err.message : "Failed to enable module." };
  }
}

export type DisableModuleResult = { ok: true; moduleKey: ModuleKey } | { ok: false; error: string };

export type AddModulePreview =
  | {
      ok: true;
      moduleKey: ModuleKey;
      /** Net (full-period) price for the module in its resolved role, in cents. */
      netCents: number;
      /** Upfront prorated charge for the remaining partial period, in cents (0 if none). */
      proratedCents: number;
      /** Resolved role in the resulting set: "standalone" if it becomes the anchor. */
      role: "standalone" | "addon";
      /** True if adding this module makes it the new anchor (demoting the previous one). */
      becomesAnchor: boolean;
      interval: Interval;
      /** End of the current billing period (when the next full invoice fires). */
      periodEnd: Date | null;
      /** Pre-formatted display strings for the confirm dialog. */
      proratedDisplay: string;
      netDisplay: string;
    }
  | { ok: false; error: string };

/**
 * Preview the mid-cycle cost of enabling `moduleKey` (brief §10.5). Returns the
 * prorated upfront charge, the resolved role, and whether the module becomes the
 * new anchor - so the confirm dialog can show "Adding Drive as an add-on costs
 * ~$X today (period ends {date})" before the user commits. Returns a no-billing
 * error when the workspace has no active subscription (the UI then routes to the
 * start-billing flow instead of the proration dialog).
 */
export async function previewAddModuleAction(input: unknown): Promise<AddModulePreview> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:module")).ok) return forbid();

  const authority = await getBillingAuthority(ctx.workspaceId);
  if (isStoreAuthority(authority))
    return { ok: false, error: new BillingProviderError(authority.provider).message };

  const sub = await ensureSubscription(ctx.workspaceId);
  if (sub.stripeSubscriptionId == null || sub.status !== "active" || !sub.billingInterval) {
    return { ok: false, error: START_BILLING_MSG };
  }

  const active = await getInstalledModules(ctx.workspaceId);
  const now = new Date();
  const charge = moduleChargeCents(
    parsed.data,
    active,
    sub.billingInterval,
    sub.anchorBillingDate,
    now,
  );

  // Period end from the anchor date (null anchor → null period end).
  let periodEnd: Date | null = null;
  if (sub.anchorBillingDate) {
    const periodMs = sub.billingInterval === "annual" ? 365 * 86_400_000 : 30 * 86_400_000;
    const anchorMs = sub.anchorBillingDate.getTime();
    const periodsSinceAnchor = Math.floor((now.getTime() - anchorMs) / periodMs);
    periodEnd = new Date(anchorMs + (periodsSinceAnchor + 1) * periodMs);
  }

  return {
    ok: true,
    moduleKey: parsed.data,
    netCents: charge.netCents,
    proratedCents: charge.proratedCents,
    role: charge.role,
    becomesAnchor: charge.becomesAnchor,
    interval: sub.billingInterval,
    periodEnd,
    proratedDisplay: formatCents(charge.proratedCents),
    netDisplay: formatCents(charge.netCents),
  };
}

export async function disableModuleAction(input: unknown): Promise<DisableModuleResult> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:module")).ok) return forbid();

  try {
    await assertStripeAuthority(ctx.workspaceId);
    // Permissive on billing state: a canceled/unbilled workspace with a stray
    // legacy module can still disable it locally. removeModuleFromSubscription
    // removes the Stripe item if one exists (returns null for legacy rows) and
    // disables the local row. Defaults to the legacy immediate-credit path.
    await removeModuleFromSubscription(ctx.workspaceId, parsed.data, ctx.user.id);
    revalidatePath("/", "layout");
    return { ok: true, moduleKey: parsed.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to disable module." };
  }
}

export type CancelModulePreviewResult =
  (CancellationPreview & { ok: true; moduleKey: ModuleKey }) | { ok: false; error: string };

/**
 * Preview the cancellation options for a single module (brief §10.6 Branch A/B).
 * Returns the branch (continuous vs offboarding) + the options with amounts + the
 * period end, so the confirm dialog can render them before the user commits. Gated
 * `manage:module`.
 */
export async function previewCancelModuleAction(
  input: unknown,
): Promise<CancelModulePreviewResult> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:module")).ok) return forbid();

  const authority = await getBillingAuthority(ctx.workspaceId);
  if (isStoreAuthority(authority))
    return { ok: false, error: new BillingProviderError(authority.provider).message };

  const sub = await getSubscription(ctx.workspaceId);
  const active = await getInstalledModules(ctx.workspaceId);
  const options = getCancellationOptions({
    activeModules: active,
    moduleKey: parsed.data,
    interval: (sub?.billingInterval ?? null) as Interval | null,
    anchorBillingDate: sub?.anchorBillingDate ?? null,
    now: new Date(),
  });
  return { ok: true, moduleKey: parsed.data, ...options };
}

const cancelOptionSchema = z.enum([
  "keep_until_end_of_cycle",
  "immediate_credit",
  "immediate_refund",
]);

export type CancelModuleResult = { ok: true; moduleKey: ModuleKey } | { ok: false; error: string };

/**
 * Cancel a single module with a chosen option (brief §10.6). Gated `manage:module`.
 * Delegates to `removeModuleFromSubscription` which executes the option (keep-until-end
 * schedules + returns; immediate_credit/immediate_refund disable + refund).
 */
export async function cancelModuleAction(input: unknown): Promise<CancelModuleResult> {
  const schema = z.object({ moduleKey: moduleKeySchema, option: cancelOptionSchema });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid cancellation request." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:module")).ok) return forbid();

  try {
    await assertStripeAuthority(ctx.workspaceId);
    await removeModuleFromSubscription(
      ctx.workspaceId,
      parsed.data.moduleKey,
      ctx.user.id,
      parsed.data.option,
    );
    revalidatePath("/", "layout");
    return { ok: true, moduleKey: parsed.data.moduleKey };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to cancel module." };
  }
}

export type ModulesPageData = {
  installed: ModuleKey[];
  /** Modules with a keep-until-end cancellation scheduled - surfaced as "Cancels on {date}" + Undo. */
  pendingCancellations: { moduleKey: ModuleKey; effectiveAt: string }[];
  canManage: boolean;
};

/** Loader for the modules settings page. */
export async function loadModulesPage(): Promise<ModulesPageData> {
  const ctx = await requireWorkspaceContext();
  const authority = await getBillingAuthority(ctx.workspaceId);
  const rows = await getModuleInstallations(ctx.workspaceId);
  const installed = resolveActiveModules(rows);
  const pendingCancellations = rows
    .filter((r) => r.status === "active" && r.pendingCancellationAt && r.cancelledAt === null)
    .map((r) => ({ moduleKey: r.moduleKey, effectiveAt: r.pendingCancellationAt!.toISOString() }));
  return {
    installed,
    pendingCancellations,
    canManage: !isStoreAuthority(authority) && authorize(ctx.role, "manage:module").ok,
  };
}

export type UndoCancelModuleResult =
  { ok: true; moduleKey: ModuleKey } | { ok: false; error: string };

/**
 * Undo a keep-until-end module cancellation (Wave 4). Clears `pendingCancellationAt` so the
 * `module-cancel-finalize` cron no longer picks the row up - the module stays billable and
 * accessible. The Stripe subscription item is NOT deleted until the finalize step, so clearing the
 * local timestamp is sufficient to revive the module. Gated `manage:module`.
 */
export async function undoCancelModuleAction(input: unknown): Promise<UndoCancelModuleResult> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:module")).ok) return forbid();

  try {
    await assertStripeAuthority(ctx.workspaceId);
    await clearPendingModuleCancellation(ctx.workspaceId, parsed.data);
    revalidatePath("/", "layout");
    return { ok: true, moduleKey: parsed.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to undo cancellation.",
    };
  }
}

// Re-export so module routes can assert enablement (gates module pages/actions).
export { assertModuleEnabled };
