"use server";

import { requireWorkspaceContext } from "@/platform/context";
import { authorizeOrAudit } from "@/server/security";
import { listAudit, type AuditListOptions, type AuditPage } from "@/platform/audit";

export type AuditPageData = { access: true; page: AuditPage } | { access: false };

/**
 * Load a page of audit entries for the workspace. Gated by `view:audit`
 * (owner/admin/accountant) - members without the grant get `access: false` and
 * the page renders a no-access card instead of a partial list.
 */
export async function loadAuditPage(opts: AuditListOptions = {}): Promise<AuditPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "view:audit")).ok) return { access: false };
  const page = await listAudit(ctx.workspaceId, opts);
  return { access: true, page };
}
