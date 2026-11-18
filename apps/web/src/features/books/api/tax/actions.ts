"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { authorize } from "@/lib/domain/permissions/index";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { isModuleEnabled } from "@/server/foundation/module-installations/index";
import { getGstMonthly } from "@/server/domains/books/index";
import { summarizeGstMonthly, type GstSummary } from "@/lib/domain/books/calc";
import { currentQuarter, listTaxPeriods, lodgeTaxPeriod } from "@/server/domains/books/tax";
import type { TaxPeriodRow } from "@/lib/domain/books/tax-types";

const forbid = (msg = "You don't have permission to manage books.") => ({
  ok: false as const,
  error: msg,
});

// --- Loader -----------------------------------------------------------------

export type TaxPageData =
  | {
      installed: true;
      gstSummary: GstSummary;
      lodgedPeriods: TaxPeriodRow[];
      canManage: boolean;
      currency: string;
      currentQuarter: { fiscalYear: number; quarter: number; label: string };
    }
  | { installed: false };

/**
 * Load the GST/BAS page. The summary is readable by any member with `view:books`;
 * lodgement needs `manage:books` (the page surfaces the Lodge button only when
 * `canManage`). GST is totalled per month in Postgres and bucketed into quarters here, so
 * the figures stay exact for any number of transactions; plus the lodged-quarter snapshots.
 */
export async function loadTaxPage(): Promise<TaxPageData> {
  const ctx = await requireWorkspaceContext();
  const [enabled, workspace] = await Promise.all([
    isModuleEnabled(ctx.workspaceId, "books"),
    getWorkspace(ctx.workspaceId),
  ]);
  if (!enabled || !workspace) return { installed: false };
  const fyStartMonth = workspace.fyStartMonth;

  const now = new Date();
  const [months, lodgedPeriods] = await Promise.all([
    getGstMonthly(ctx.workspaceId),
    listTaxPeriods(ctx.workspaceId),
  ]);
  const canManage = authorize(ctx.role, "manage:books").ok;

  const gstSummary = summarizeGstMonthly(months, fyStartMonth);

  return {
    installed: true,
    gstSummary,
    lodgedPeriods,
    canManage,
    currency: workspace.defaultCurrency,
    currentQuarter: currentQuarter(now, fyStartMonth),
  };
}

// --- Lodge action -----------------------------------------------------------

const lodgeSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  quarter: z.number().int().min(1).max(4),
});

export type LodgeTaxPeriodResult = { ok: true } | { ok: false; error: string };

export async function lodgeTaxPeriodAction(input: unknown): Promise<LodgeTaxPeriodResult> {
  const parsed = lodgeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid quarter." };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();

  try {
    const workspace = await getWorkspace(ctx.workspaceId);
    const fyStartMonth = workspace?.fyStartMonth ?? 7;
    await lodgeTaxPeriod(
      ctx.workspaceId,
      parsed.data.fiscalYear,
      parsed.data.quarter,
      ctx.user.id,
      fyStartMonth,
    );
    revalidatePath("/books/tax");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to lodge tax period.",
    };
  }
}
