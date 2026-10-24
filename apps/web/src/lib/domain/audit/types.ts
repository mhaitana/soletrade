import type { AuditLogId, UserId, WorkspaceId } from "@/types/ids";

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
