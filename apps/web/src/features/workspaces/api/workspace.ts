"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { getWorkspace, updateWorkspace } from "@/server/foundation/workspaces/index";
import type { WorkspaceRow } from "@/lib/domain/workspaces/types";
import { SUPPORTED_CURRENCY_CODES, FINANCIAL_YEAR_START_MONTH_VALUES } from "@/config/currencies";
import { parsePaymentMethods, paymentMethodsSchema } from "@/types/payment-methods";

const PREFIX_RE = /^[A-Za-z0-9_-]{0,10}$/;

const workspaceSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100, "Name is too long."),
  defaultCurrency: z.enum(SUPPORTED_CURRENCY_CODES),
  invoicePrefix: z
    .string()
    .trim()
    .max(10, "Use at most 10 characters.")
    .regex(PREFIX_RE, "Use letters, numbers, hyphens, or underscores only."),
  quotePrefix: z
    .string()
    .trim()
    .max(10, "Use at most 10 characters.")
    .regex(PREFIX_RE, "Use letters, numbers, hyphens, or underscores only."),
  timezone: z.string().trim().min(1, "Timezone is required."),
  fyStartMonth: z
    .number()
    .int()
    .min(1, "Financial year start is required.")
    .max(12, "Use a month between 1 and 12.")
    .refine((m) => (FINANCIAL_YEAR_START_MONTH_VALUES as readonly number[]).includes(m), {
      message: "Use a month between 1 and 12.",
    }),
  paymentMethods: paymentMethodsSchema,
});

export type UpdateWorkspaceResult = { ok: true } | { ok: false; error: string };

const forbid = (msg = "You don't have permission to do that.") => ({
  ok: false as const,
  error: msg,
});

/**
 * Update the workspace's editable settings (Wave 4 - `/settings/general`): name + currency +
  invoice/quote prefixes + timezone. Gated `update:workspace` (owner/admin). The slug stays
 * immutable v1 (a separate `transfer:workspace` flow would own a slug change).
 */
export async function updateWorkspaceAction(input: unknown): Promise<UpdateWorkspaceResult> {
  const parsed = workspaceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid workspace settings." };
  }
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "update:workspace")).ok) return forbid();
  try {
    const updated = await updateWorkspace(ctx.workspaceId, parsed.data, ctx.user.id);
    if (!updated) return { ok: false, error: "Workspace not found." };
    // The workspace name + currency appear across the shell + dashboards.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update workspace." };
  }
}

export interface GeneralSettingsPageData {
  workspace: Pick<
    WorkspaceRow,
    | "id"
    | "name"
    | "slug"
    | "defaultCurrency"
    | "invoicePrefix"
    | "quotePrefix"
    | "timezone"
    | "fyStartMonth"
    | "paymentMethods"
  >;
  canManage: boolean;
}

/** Server-only loader for the general settings page. */
export async function loadGeneralSettingsPage(): Promise<GeneralSettingsPageData | null> {
  const ctx = await requireWorkspaceContext();
  const workspace = await getWorkspace(ctx.workspaceId);
  if (!workspace) return null;
  const paymentMethods = parsePaymentMethods(workspace.paymentMethods);
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      defaultCurrency: workspace.defaultCurrency,
      invoicePrefix: workspace.invoicePrefix,
      quotePrefix: workspace.quotePrefix,
      timezone: workspace.timezone,
      fyStartMonth: workspace.fyStartMonth,
      paymentMethods: paymentMethods.ok ? paymentMethods.methods : [],
    },
    canManage: ctx.role === "owner" || ctx.role === "admin",
  };
}
