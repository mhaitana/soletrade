import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, unwrap } from "@/server/db/helpers";
import { branded, type AuditLogId, type UserId, type WorkspaceId } from "@/shared/types/ids";
import type { Json } from "@/server/db/types";

export interface AuditInput {
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

export interface AuditRow {
  id: AuditLogId;
  action: string;
  workspaceId: WorkspaceId;
  actorUserId: UserId | null;
  /** Actor display name (resolved via resource embedding on users). null when no actor. */
  actorFullName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: Date;
}

/** Cursor for keyset pagination (createdAt desc + id desc tiebreaker). */
export interface AuditCursor {
  /**
   * Raw PostgREST ISO string for `created_at` - preserves full µs precision
   * (`now()` is µs-precise; a JS `Date` truncates to ms, breaking the keyset
   * `eq`/`lt` when rows share a millisecond). Kept as a string, never a `Date`.
   */
  createdAt: string;
  id: AuditLogId;
}

export interface AuditListOptions {
  /** Restrict to a set of actions (OR), e.g. ["member.remove", "member.invite"]. */
  actions?: string[];
  /**
   * Restrict to actions with a dotted prefix, e.g. "billing." matches
   * "billing.subscription.update". Handy because audit actions are namespaced
   * (`member.*`, `billing.*`, `invoice.*`, …) and enumerating every leaf is noisy.
   */
  actionPrefix?: string;
  /** Restrict to a single target type, e.g. "member", "subscription". */
  targetType?: string;
  limit?: number;
  /** Keyset cursor: return rows strictly before this (createdAt, id). */
  before?: AuditCursor;
}

export interface AuditPage {
  items: AuditRow[];
  nextCursor: AuditCursor | null;
}

const AUDIT_COLUMNS =
  "id, action, workspace_id, actor_user_id, target_type, target_id, metadata, ip, created_at, users ( full_name, email )";

/** Maps a snake_case PostgREST audit_logs row (+ embedded actor) to `AuditRow`. */
function toAuditRow(r: {
  id: string;
  action: string;
  workspace_id: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Json | null;
  ip: string | null;
  created_at: string;
  users: { full_name: string | null; email: string } | null;
}): AuditRow {
  return {
    id: branded<"AuditLogId">(r.id),
    action: r.action,
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    actorUserId: r.actor_user_id ? branded<"UserId">(r.actor_user_id) : null,
    actorFullName: r.users?.full_name ?? null,
    actorEmail: r.users?.email ?? null,
    targetType: r.target_type,
    targetId: r.target_id,
    // PostgREST returns jsonb as the generated `Json` union; cast to the row contract.
    metadata: r.metadata as Record<string, unknown> | null,
    ip: r.ip,
    createdAt: parsePgTimestamp(r.created_at),
  };
}

/**
 * Record an authorization denial as an `authz.denied` audit row (brief §13 -
 * "log suspicious permission failures"). `actorUserId` is nullable on
 * `audit_logs`, so an anonymous / no-session attempt fits naturally; the IP is
 * the request IP (caller-resolved via `getClientIp`). Best-effort callers wrap
 * this in `.catch()` so a logging failure never changes the authz outcome.
 */
export async function auditAuthzDenial(input: {
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  permission: string;
  reason: "insufficient_role" | "no_membership";
  ip?: string;
}): Promise<AuditLogId> {
  return writeAudit({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: "authz.denied",
    targetType: "permission",
    targetId: input.permission,
    metadata: { permission: input.permission, reason: input.reason },
    ip: input.ip,
  });
}

/**
 * Append an audit entry. Audit is append-only and never soft-deleted. Use for
 * sensitive mutations only (billing, members, module changes, authz failures).
 */
export async function writeAudit(input: AuditInput): Promise<AuditLogId> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("audit_logs")
      .insert({
        workspace_id: input.workspaceId,
        actor_user_id: input.actorUserId ?? null,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        metadata: (input.metadata ?? null) as Json,
        ip: input.ip,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to write audit log");
  return branded<"AuditLogId">(row.id);
}

/**
 * List audit entries for a workspace, newest first. Always scoped to the
 * workspace (IDOR-safe - never returns another workspace's entries). Surfaced
 * only to roles with `view:audit` (owner/admin/accountant); the caller enforces
 * that gate. Optional filters by action / target type, keyset cursor pagination.
 */
export async function listAudit(
  workspaceId: WorkspaceId,
  opts: AuditListOptions = {},
): Promise<AuditPage> {
  const supabase = getDataClient();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let query = supabase.from("audit_logs").select(AUDIT_COLUMNS).eq("workspace_id", workspaceId);

  if (opts.actions && opts.actions.length > 0) {
    query = query.in("action", opts.actions);
  }
  if (opts.actionPrefix) {
    // `like` (case-sensitive) matches the original Drizzle `like` - audit actions
    // are lowercase by convention, so case-sensitive prefix matching is correct.
    query = query.like("action", `${opts.actionPrefix}%`);
  }
  if (opts.targetType) {
    query = query.eq("target_type", opts.targetType);
  }
  if (opts.before) {
    // Keyset: (created_at, id) strictly < before - created_at < cursor OR
    // (created_at = cursor AND id < cursor). PostgREST expresses this as an `or`
    // with a nested `and(...)` for the tiebreaker. `opts.before.createdAt` is the
    // raw µs-precision ISO string (see AuditCursor) so the comparison is exact.
    const iso = opts.before.createdAt;
    query = query.or(`created_at.lt.${iso},and(created_at.eq.${iso},id.lt.${opts.before.id})`);
  }

  const rows = await unwrap(
    query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(toAuditRow);
  const last = pageRows[pageRows.length - 1];
  // Cursor carries the raw `created_at` string (µs precision) - NOT a Date.
  const nextCursor: AuditCursor | null =
    hasMore && last ? { createdAt: last.created_at, id: branded<"AuditLogId">(last.id) } : null;
  return { items, nextCursor };
}
