"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { getWorkspace } from "@/platform/workspaces";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import { listTransactions } from "@/modules/books";
import { summarizeGst, type GstSummary } from "@/modules/books/calc";
import {
  currentQuarter,
  listTaxPeriods,
  lodgeTaxPeriod,
  type TaxPeriodRow,
} from "@/modules/books/tax";

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
      currentQuarter: { fiscalYear: number; quarter: number; label: string };
    }
  | { installed: false };

/**
 * Load the GST/BAS page. The summary is readable by any member with `view:books`;
 * lodgement needs `manage:books` (the page surfaces the Lodge button only when
 * `canManage`). Fetches up to 2000 transactions for the GST aggregation (matches the
 * Books summary cap) + the lodged-quarter snapshots.
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
  const [rows, lodgedPeriods, canManage] = await Promise.all([
    listTransactions(ctx.workspaceId, { limit: 2000 }),
    listTaxPeriods(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:books").ok),
  ]);

  const gstSummary = summarizeGst(
    rows.map((r) => ({ type: r.type, gstCents: r.gstCents, date: r.date })),
    fyStartMonth,
  );

  return {
    installed: true,
    gstSummary,
    lodgedPeriods,
    canManage,
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
