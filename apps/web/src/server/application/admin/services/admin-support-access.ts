import "server-only";
import { getAdminDb } from "@/server/foundation/identity/db";
import type {
  SupportAccessLevel,
  SupportAccessRequest,
  SupportAccessScope,
  SupportAccessSession,
} from "@/lib/domain/admin/types";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { writeAdminAuditEvent } from "@/server/application/admin/services/admin-audit";

export interface RequestSupportAccessParams {
  workspaceId: string;
  ticketId?: string;
  scopes: SupportAccessScope[];
  accessLevel: SupportAccessLevel;
  reason: string;
  requestedDurationMinutes?: number;
  customerExplanation?: string;
}

/**
 * Support agent requests temporary customer-approved access to a workspace.
 */
export async function requestSupportAccess(
  params: RequestSupportAccessParams,
): Promise<SupportAccessRequest> {
  const ctx = await requireAdminContext("create:support_access");
  if (!params.reason || params.reason.trim().length < 5) {
    throw new Error("A detailed reason is required to request support access.");
  }
  if (!params.scopes || params.scopes.length === 0) {
    throw new Error("At least one support access scope must be requested.");
  }

  const duration = Math.min(params.requestedDurationMinutes ?? 60, 1440); // max 24 hours
  const db = getAdminDb();

  const { data, error } = await db
    .from("support_access_requests")
    .insert({
      workspace_id: params.workspaceId,
      ticket_id: params.ticketId ?? null,
      requested_by_admin_id: ctx.adminUser.id,
      scopes: params.scopes,
      access_level: params.accessLevel,
      reason: params.reason,
      requested_duration_minutes: duration,
      customer_explanation: params.customerExplanation ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create support access request: ${error?.message}`);
  }

  const row = data as {
    id: string;
    workspace_id: string;
    ticket_id?: string;
    requested_by_admin_id: string;
    scopes: SupportAccessScope[];
    access_level: SupportAccessLevel;
    reason: string;
    requested_duration_minutes: number;
    customer_explanation?: string;
    status: "pending" | "approved" | "rejected" | "revoked";
    created_at: string;
    updated_at: string;
  };

  await writeAdminAuditEvent({
    actorAdminId: ctx.adminUser.id,
    actorRole: ctx.roles[0] ?? "support_agent",
    action: "request_support_access",
    targetType: "support_access_request",
    targetId: row.id,
    workspaceId: params.workspaceId,
    reason: params.reason,
    metadata: { scopes: params.scopes, duration },
  });

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ticketId: row.ticket_id,
    requestedByAdminId: row.requested_by_admin_id,
    scopes: row.scopes,
    accessLevel: row.access_level,
    reason: row.reason,
    requestedDurationMinutes: row.requested_duration_minutes,
    customerExplanation: row.customer_explanation,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Customer approves a pending support access request. Can optionally reduce scopes or duration.
 */
export async function approveSupportAccess(
  requestId: string,
  approvingUserId: string,
  reducedScopes?: SupportAccessScope[],
  reducedDurationMinutes?: number,
): Promise<SupportAccessSession> {
  const db = getAdminDb();

  const { data: reqRow, error: reqErr } = await db
    .from("support_access_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (reqErr || !reqRow) {
    throw new Error("Support access request not found.");
  }

  const request = reqRow as {
    id: string;
    workspace_id: string;
    ticket_id?: string;
    requested_by_admin_id: string;
    scopes: SupportAccessScope[];
    access_level: SupportAccessLevel;
    reason: string;
    requested_duration_minutes: number;
  };

  const finalScopes = reducedScopes ?? request.scopes;
  const finalDuration = Math.min(
    reducedDurationMinutes ?? request.requested_duration_minutes,
    1440,
  );

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + finalDuration * 60 * 1000);

  const { data: sessRow, error: sessErr } = await db
    .from("support_access_sessions")
    .insert({
      request_id: request.id,
      workspace_id: request.workspace_id,
      ticket_id: request.ticket_id ?? null,
      approved_by_user_id: approvingUserId,
      admin_user_id: request.requested_by_admin_id,
      scopes: finalScopes,
      access_level: request.access_level,
      reason: request.reason,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      status: "active",
    })
    .select()
    .single();

  if (sessErr || !sessRow) {
    throw new Error(`Failed to create support access session: ${sessErr?.message}`);
  }

  await db
    .from("support_access_requests")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", requestId);

  const s = sessRow as {
    id: string;
    request_id: string;
    workspace_id: string;
    ticket_id?: string;
    approved_by_user_id: string;
    admin_user_id: string;
    scopes: SupportAccessScope[];
    access_level: SupportAccessLevel;
    reason: string;
    starts_at: string;
    expires_at: string;
  };

  return {
    id: s.id,
    requestId: s.request_id,
    workspaceId: s.workspace_id,
    ticketId: s.ticket_id,
    approvedByUserId: s.approved_by_user_id,
    adminUserId: s.admin_user_id,
    scopes: s.scopes,
    accessLevel: s.access_level,
    reason: s.reason,
    startsAt: new Date(s.starts_at),
    expiresAt: new Date(s.expires_at),
    status: "active",
  };
}

/**
 * Customer rejects a support access request.
 */
export async function rejectSupportAccess(requestId: string): Promise<void> {
  const db = getAdminDb();
  await db
    .from("support_access_requests")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", requestId);
}

/**
 * Revoke an active support access session immediately.
 */
export async function revokeSupportAccess(
  sessionId: string,
  revokingUserId: string,
): Promise<void> {
  const db = getAdminDb();
  await db
    .from("support_access_sessions")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_by_user_id: revokingUserId,
    })
    .eq("id", sessionId);
}

/**
 * Resolve the admin's currently active (unexpired, non-revoked) support access session,
 * regardless of workspace. Used by the admin layout to render the persistent
 * "customer-approved support access" banner (Principle #15). Returns the
 * most-recently-expiring active session, or null if the admin has none.
 */
export async function getActiveSupportAccessSession(
  adminUserId: string,
): Promise<SupportAccessSession | null> {
  const db = getAdminDb();
  const nowIso = new Date().toISOString();

  const { data: rows } = await db
    .from("support_access_sessions")
    .select("*")
    .eq("admin_user_id", adminUserId)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: false })
    .limit(1);

  if (!rows || rows.length === 0) return null;

  const s = rows[0] as {
    id: string;
    request_id: string;
    workspace_id: string;
    ticket_id?: string;
    approved_by_user_id: string;
    admin_user_id: string;
    scopes: SupportAccessScope[];
    access_level: SupportAccessLevel;
    reason: string;
    starts_at: string;
    expires_at: string;
    status: string;
  };

  return {
    id: s.id,
    requestId: s.request_id,
    workspaceId: s.workspace_id,
    ticketId: s.ticket_id,
    approvedByUserId: s.approved_by_user_id,
    adminUserId: s.admin_user_id,
    scopes: s.scopes,
    accessLevel: s.access_level,
    reason: s.reason,
    startsAt: new Date(s.starts_at),
    expiresAt: new Date(s.expires_at),
    status: "active",
  };
}

/**
 * Validate an active support access session for a specific admin and workspace.
 */
export async function validateSupportAccessSession(
  adminUserId: string,
  workspaceId: string,
): Promise<SupportAccessSession | null> {
  const db = getAdminDb();
  const nowIso = new Date().toISOString();

  const { data: rows } = await db
    .from("support_access_sessions")
    .select("*")
    .eq("admin_user_id", adminUserId)
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("expires_at", { ascending: false })
    .limit(1);

  if (!rows || rows.length === 0) return null;

  const s = rows[0] as {
    id: string;
    request_id: string;
    workspace_id: string;
    ticket_id?: string;
    approved_by_user_id: string;
    admin_user_id: string;
    scopes: SupportAccessScope[];
    access_level: SupportAccessLevel;
    reason: string;
    starts_at: string;
    expires_at: string;
  };

  return {
    id: s.id,
    requestId: s.request_id,
    workspaceId: s.workspace_id,
    ticketId: s.ticket_id,
    approvedByUserId: s.approved_by_user_id,
    adminUserId: s.admin_user_id,
    scopes: s.scopes,
    accessLevel: s.access_level,
    reason: s.reason,
    startsAt: new Date(s.starts_at),
    expiresAt: new Date(s.expires_at),
    status: "active",
  };
}

export async function logSupportAccessEvent(
  sessionId: string,
  action: string,
  targetEntity?: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = getAdminDb();
  await db.from("support_access_events").insert({
    session_id: sessionId,
    action,
    target_entity: targetEntity ?? null,
    target_id: targetId ?? null,
    metadata: metadata ?? null,
  });
}
