import type { ActivityEventId, UserId, WorkspaceId } from "@/types/ids";

export interface ActivityInput {
  type: string;
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityRow {
  id: ActivityEventId;
  type: string;
  workspaceId: WorkspaceId;
  actorUserId: UserId | null;
  /** Actor display name (resolved via resource embedding on users). null when no actor. */
  actorFullName: string | null;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ActivityCursor {
  /**
   * Raw PostgREST ISO string for `created_at` - MUST preserve the full microsecond
   * precision Postgres stores (`now()` is µs-precise). A JS `Date` only keeps
   * milliseconds, so round-tripping `new Date(iso).toISOString()` truncates the
   * sub-ms digits and the keyset `created_at.eq`/`.lt` then matches nothing when
   * rows share a millisecond. Kept as a string, never converted to `Date`.
   */
  createdAt: string;
  id: ActivityEventId;
}

export interface ActivityListOptions {
  /** Restrict to a set of event types (OR). */
  types?: string[];
  /** Restrict to a single entity type, e.g. "customer". */
  entityType?: string;
  /** Restrict to a single entity id (implies same entityType in practice). */
  entityId?: string;
  limit?: number;
  /** Keyset cursor: return rows strictly before this (createdAt, id). */
  before?: ActivityCursor;
}

export interface ActivityPage {
  items: ActivityRow[];
  nextCursor: ActivityCursor | null;
}
