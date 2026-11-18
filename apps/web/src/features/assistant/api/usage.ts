"use server";

import { authorize } from "@/lib/domain/permissions/index";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import {
  getAssistantUsageOverview,
  type AssistantUsageOverview,
} from "@/server/application/assistant/usage";

export type AssistantUsageData =
  { access: true; usage: AssistantUsageOverview | null } | { access: false };

/**
 * What hAI has used in the signed-in person's workspace, for the Usage card in settings.
 * Usage is workspace management information, like billing, so it takes the permission
 * that guards managing billing (`manage:billing`: owners and admins). Everyone else gets
 * `access: false` and the page leaves the card out. Looking at the settings page is not
 * an attempt to do something forbidden, so the plain check is used and no denial is
 * written to the audit log. The workspace is the one resolved from the session.
 *
 * `usage: null` means the ledger could not be read. The card says so instead of the error
 * taking down the rest of the settings page, which other cards share.
 */
export async function loadAssistantUsage(): Promise<AssistantUsageData> {
  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:billing").ok) return { access: false };
  try {
    return { access: true, usage: await getAssistantUsageOverview(ctx.workspaceId) };
  } catch (err) {
    console.error("[assistant] could not load usage:", err);
    return { access: true, usage: null };
  }
}
