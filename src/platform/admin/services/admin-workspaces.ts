import "server-only";
import { getAdminDb } from "./db";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";

export interface AdminWorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  ownerUserId: string;
  defaultCurrency: string;
  createdAt: Date;
  isSuspended: boolean;
}

/**
 * Search workspaces by name or slug (operational metadata only).
 * Principle #3: Does not return customer business content.
 */
export async function searchPlatformWorkspaces(
  queryText?: string,
): Promise<AdminWorkspaceSummary[]> {
  await requireAdminContext("view:workspaces");
  const db = getAdminDb();

  let query = db
    .from("workspaces")
    .select("id, name, slug, owner_user_id, default_currency, created_at, deleted_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (queryText && queryText.trim().length > 0) {
    query = query.ilike("name", `%${queryText.trim()}%`);
  }

  const { data: rows } = await query;
  if (!rows) return [];

  return (
    rows as Array<{
      id: string;
      name: string;
      slug: string;
      owner_user_id: string;
      default_currency: string;
      created_at: string;
      deleted_at: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerUserId: row.owner_user_id,
    defaultCurrency: row.default_currency,
    createdAt: new Date(row.created_at),
    isSuspended: Boolean(row.deleted_at),
  }));
}

/**
 * Suspend a workspace. Requires a reason and creates an immutable audit log.
 */
export async function suspendWorkspace(workspaceId: string, reason: string): Promise<void> {
  const ctx = await requireAdminContext("manage:workspaces");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A clear reason is required to suspend a workspace.");
  }

  const db = getAdminDb();
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("workspaces")
    .update({ deleted_at: nowIso })
    .eq("id", workspaceId);
  if (error) {
    throw new Error(`Failed to suspend workspace: ${error.message}`);
  }

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "operations_admin",
    action: "suspend_workspace",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    reason,
  });
}

/**
 * Restore a suspended workspace. Requires a reason and creates an immutable audit log.
 */
export async function restoreWorkspace(workspaceId: string, reason: string): Promise<void> {
  const ctx = await requireAdminContext("manage:workspaces");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A clear reason is required to restore a workspace.");
  }

  const db = getAdminDb();
  const { error } = await db.from("workspaces").update({ deleted_at: null }).eq("id", workspaceId);
  if (error) {
    throw new Error(`Failed to restore workspace: ${error.message}`);
  }

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "operations_admin",
    action: "restore_workspace",
    targetType: "workspace",
    targetId: workspaceId,
    workspaceId,
    reason,
  });
}

/**
 * Add an auditable internal note to a workspace.
 */
export async function addWorkspaceInternalNote(
  workspaceId: string,
  content: string,
): Promise<void> {
  const ctx = await requireAdminContext("manage:workspaces");
  const db = getAdminDb();

  await db.from("admin_internal_notes").insert({
    target_type: "workspace",
    target_id: workspaceId,
    author_admin_id: ctx.adminUser.id,
    content,
  });
}
