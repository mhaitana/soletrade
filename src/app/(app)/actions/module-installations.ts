"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { assertModuleEnabled, getInstalledModules } from "@/platform/module-installations";
import { ensureSubscription } from "@/platform/billing/subscriptions";
import {
  addModuleToSubscription,
  removeModuleFromSubscription,
  UpgradeRequiredError,
} from "@/platform/billing/modules";
import { MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";

const moduleKeySchema = z.enum(MODULE_KEYS);
const forbid = (msg = "You don't have permission to manage modules.") => ({
  ok: false as const,
  error: msg,
});

const UPGRADE_MSG = "Upgrade to Pro to enable modules.";

export type EnableModuleResult = { ok: true; moduleKey: ModuleKey } | { ok: false; error: string };

export async function enableModuleAction(input: unknown): Promise<EnableModuleResult> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:module").ok) return forbid();

  try {
    // Free workspaces can't have paid modules — surface an upgrade prompt instead
    // of hitting the orchestrator (which would throw UpgradeRequiredError anyway).
    const sub = await ensureSubscription(ctx.workspaceId);
    if (sub.tier !== "pro") return { ok: false, error: UPGRADE_MSG };

    await addModuleToSubscription(ctx.workspaceId, parsed.data, ctx.user.id);
    revalidatePath("/", "layout");
    return { ok: true, moduleKey: parsed.data };
  } catch (err) {
    if (err instanceof UpgradeRequiredError) return { ok: false, error: UPGRADE_MSG };
    return { ok: false, error: err instanceof Error ? err.message : "Failed to enable module." };
  }
}

export type DisableModuleResult = { ok: true; moduleKey: ModuleKey } | { ok: false; error: string };

export async function disableModuleAction(input: unknown): Promise<DisableModuleResult> {
  const parsed = moduleKeySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown module." };

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:module").ok) return forbid();

  try {
    // Permissive on tier: a Free workspace with a stray legacy module can still
    // disable it locally. removeModuleFromSubscription removes the Stripe item if
    // one exists (returns null for legacy rows) and disables the local row.
    await removeModuleFromSubscription(ctx.workspaceId, parsed.data, ctx.user.id);
    revalidatePath("/", "layout");
    return { ok: true, moduleKey: parsed.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to disable module." };
  }
}

export type ModulesPageData = { installed: ModuleKey[]; canManage: boolean };

/** Loader for the modules settings page. */
export async function loadModulesPage(): Promise<ModulesPageData> {
  const ctx = await requireWorkspaceContext();
  const [installed] = await Promise.all([getInstalledModules(ctx.workspaceId)]);
  return { installed, canManage: authorize(ctx.role, "manage:module").ok };
}

// Re-export so module routes can assert enablement (gates module pages/actions).
export { assertModuleEnabled };
