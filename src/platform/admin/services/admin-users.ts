import "server-only";
import { getAdminDb } from "./db";
import { requireAdminContext } from "./admin-auth";
import { writeAdminAuditEvent } from "./admin-audit";

export interface AdminUserMetadataSummary {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: Date;
  isSuspended: boolean;
  workspaceMemberships: Array<{
    workspaceId: string;
    role: string;
  }>;
}

/**
 * Search platform users by email or ID (operational metadata only).
 * Principle #3: Does not return customer business content.
 */
export async function searchPlatformUsers(queryText?: string): Promise<AdminUserMetadataSummary[]> {
  await requireAdminContext("view:users");
  const db = getAdminDb();

  let query = db
    .from("users")
    .select("id, email, full_name, created_at, deleted_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (queryText && queryText.trim().length > 0) {
    query = query.ilike("email", `%${queryText.trim()}%`);
  }

  const { data: rows } = await query;
  if (!rows) return [];

  const summaries: AdminUserMetadataSummary[] = [];
  for (const row of rows as Array<{
    id: string;
    email: string;
    full_name: string | null;
    created_at: string;
    deleted_at: string | null;
  }>) {
    summaries.push({
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      createdAt: new Date(row.created_at),
      isSuspended: Boolean(row.deleted_at),
      workspaceMemberships: [],
    });
  }

  return summaries;
}

/**
 * Suspend a user account. Requires a reason and creates an immutable audit log.
 */
export async function suspendUserAccount(userId: string, reason: string): Promise<void> {
  const ctx = await requireAdminContext("manage:users");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A clear reason is required to suspend a user account.");
  }

  const db = getAdminDb();
  const nowIso = new Date().toISOString();
  const { error } = await db.from("users").update({ deleted_at: nowIso }).eq("id", userId);
  if (error) {
    throw new Error(`Failed to suspend user: ${error.message}`);
  }

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "operations_admin",
    action: "suspend_user",
    targetType: "user",
    targetId: userId,
    userId,
    reason,
  });
}

/**
 * Restore a suspended user account. Requires a reason and creates an immutable audit log.
 */
export async function restoreUserAccount(userId: string, reason: string): Promise<void> {
  const ctx = await requireAdminContext("manage:users");
  if (!reason || reason.trim().length < 3) {
    throw new Error("A clear reason is required to restore a user account.");
  }

  const db = getAdminDb();
  const { error } = await db.from("users").update({ deleted_at: null }).eq("id", userId);
  if (error) {
    throw new Error(`Failed to restore user: ${error.message}`);
  }

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "operations_admin",
    action: "restore_user",
    targetType: "user",
    targetId: userId,
    userId,
    reason,
  });
}

/**
 * Add an auditable internal note to a user.
 */
export async function addUserInternalNote(userId: string, content: string): Promise<void> {
  const ctx = await requireAdminContext("manage:users");
  const db = getAdminDb();

  await db.from("admin_internal_notes").insert({
    target_type: "user",
    target_id: userId,
    author_admin_id: ctx.adminUser.id,
    content,
  });
}
