import "server-only";
import { getAdminDb } from "./db";
import type { AdminAuditEvent, AdminRole } from "@/platform/admin/types";

export interface WriteAdminAuditEventParams {
  actorAdminId: string;
  actorRole: AdminRole;
  action: string;
  targetType: string;
  targetId: string;
  workspaceId?: string;
  userId?: string;
  ticketId?: string;
  reason?: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write an immutable audit log entry for an administrative action.
 */
export async function writeAdminAuditEvent(
  params: WriteAdminAuditEventParams,
): Promise<AdminAuditEvent> {
  const db = getAdminDb();
  const { data, error } = await db
    .from("admin_audit_events")
    .insert({
      actor_admin_id: params.actorAdminId,
      actor_role: params.actorRole,
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
      workspace_id: params.workspaceId ?? null,
      user_id: params.userId ?? null,
      ticket_id: params.ticketId ?? null,
      reason: params.reason ?? null,
      before_state: params.beforeState ?? null,
      after_state: params.afterState ?? null,
      metadata: params.metadata ?? null,
      ip_address: params.ipAddress ?? null,
      user_agent: params.userAgent ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to write admin audit event: ${error?.message ?? "unknown"}`);
  }

  const row = data as {
    id: string;
    actor_admin_id: string;
    actor_role: AdminRole;
    action: string;
    target_type: string;
    target_id: string;
    workspace_id?: string;
    user_id?: string;
    ticket_id?: string;
    reason?: string;
    before_state?: Record<string, unknown>;
    after_state?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    ip_address?: string;
    user_agent?: string;
    created_at: string;
  };

  return {
    id: row.id,
    actorAdminId: row.actor_admin_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    ticketId: row.ticket_id,
    reason: row.reason,
    beforeState: row.before_state,
    afterState: row.after_state,
    metadata: row.metadata,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: new Date(row.created_at),
  };
}

export interface AuditLogFilterParams {
  actorAdminId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  limit?: number;
}

export async function listAdminAuditEvents(
  filters: AuditLogFilterParams = {},
): Promise<AdminAuditEvent[]> {
  const db = getAdminDb();
  let query = db
    .from("admin_audit_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.actorAdminId) {
    query = query.eq("actor_admin_id", filters.actorAdminId);
  }
  if (filters.action) {
    query = query.eq("action", filters.action);
  }
  if (filters.targetType) {
    query = query.eq("target_type", filters.targetType);
  }
  if (filters.targetId) {
    query = query.eq("target_id", filters.targetId);
  }
  if (filters.workspaceId) {
    query = query.eq("workspace_id", filters.workspaceId);
  }

  const { data } = await query;
  if (!data) return [];

  return (
    data as Array<{
      id: string;
      actor_admin_id: string;
      actor_role: AdminRole;
      action: string;
      target_type: string;
      target_id: string;
      workspace_id?: string;
      user_id?: string;
      ticket_id?: string;
      reason?: string;
      before_state?: Record<string, unknown>;
      after_state?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      ip_address?: string;
      user_agent?: string;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    actorAdminId: row.actor_admin_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    ticketId: row.ticket_id,
    reason: row.reason,
    beforeState: row.before_state,
    afterState: row.after_state,
    metadata: row.metadata,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: new Date(row.created_at),
  }));
}
