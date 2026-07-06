import "server-only";
import { and, desc, eq, inArray, like, lt, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { auditLogs, users } from "@/server/db/schema";
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

export interface AuditRow {
  id: AuditLogId;
  action: string;
  workspaceId: WorkspaceId;
  actorUserId: UserId | null;
  /** Actor display name (resolved via left join on users). null when no actor. */
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
  createdAt: Date;
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

/**
 * List audit entries for a workspace, newest first. Always scoped to the
 * workspace (IDOR-safe — never returns another workspace's entries). Surfaced
 * only to roles with `view:audit` (owner/admin/accountant); the caller enforces
 * that gate. Optional filters by action / target type, keyset cursor pagination.
 */
export async function listAudit(
  workspaceId: WorkspaceId,
  opts: AuditListOptions = {},
): Promise<AuditPage> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const conditions: (SQL | undefined)[] = [eq(auditLogs.workspaceId, workspaceId)];

  if (opts.actions && opts.actions.length > 0) {
    conditions.push(inArray(auditLogs.action, opts.actions));
  }
  if (opts.actionPrefix) {
    conditions.push(like(auditLogs.action, `${opts.actionPrefix}%`));
  }
  if (opts.targetType) {
    conditions.push(eq(auditLogs.targetType, opts.targetType));
  }
  if (opts.before) {
    // Keyset: createdAt < cursor OR (createdAt = cursor AND id < cursor.id)
    conditions.push(
      or(
        lt(auditLogs.createdAt, opts.before.createdAt),
        and(eq(auditLogs.createdAt, opts.before.createdAt), lt(auditLogs.id, opts.before.id)),
      ),
    );
  }

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      workspaceId: auditLogs.workspaceId,
      actorUserId: auditLogs.actorUserId,
      actorFullName: users.fullName,
      actorEmail: users.email,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      metadata: auditLogs.metadata,
      ip: auditLogs.ip,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit + 1); // +1 to detect a next page without a separate count query.

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    action: r.action,
    workspaceId: r.workspaceId,
    actorUserId: r.actorUserId,
    actorFullName: r.actorFullName,
    actorEmail: r.actorEmail,
    targetType: r.targetType,
    targetId: r.targetId,
    // drizzle's jsonb column infers as `unknown`; cast to the row contract.
    metadata: r.metadata as Record<string, unknown> | null,
    ip: r.ip,
    createdAt: r.createdAt,
  }));

  const last = items[items.length - 1];
  const nextCursor: AuditCursor | null =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { items, nextCursor };
}
