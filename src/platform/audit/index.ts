import "server-only";
import { getDb } from "@/server/db";
import { auditLogs } from "@/server/db/schema";
import type { AuditLogId, UserId, WorkspaceId } from "@/shared/types/ids";

export interface AuditInput {
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/**
 * Append an audit entry. Audit is append-only and never soft-deleted. Use for
 * sensitive mutations only (billing, members, module changes, authz failures).
 */
export async function writeAudit(input: AuditInput): Promise<AuditLogId> {
  const db = getDb();
  const rows = await db
    .insert(auditLogs)
    .values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ip: input.ip,
    })
    .returning({ id: auditLogs.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to write audit log");
  return row.id;
}
