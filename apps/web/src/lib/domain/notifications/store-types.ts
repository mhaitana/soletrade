import type { NotificationId, UserId, WorkspaceId } from "@/types/ids";

export interface NotificationRow {
  id: NotificationId;
  workspaceId: WorkspaceId;
  userId: UserId;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotificationCursor {
  /**
   * Raw PostgREST ISO string for `created_at` - preserves full µs precision
   * (`now()` is µs-precise; a JS `Date` truncates to ms, breaking the keyset
   * `eq`/`lt` when rows share a millisecond). Kept as a string, never a `Date`.
   */
  createdAt: string;
  id: NotificationId;
}

export interface NotificationListOptions {
  /** Only unread rows (readAt is null). */
  unreadOnly?: boolean;
  limit?: number;
  /** Keyset cursor: return rows strictly before this (createdAt, id). */
  before?: NotificationCursor;
}

export interface NotificationPage {
  items: NotificationRow[];
  nextCursor: NotificationCursor | null;
}

export interface CreateNotificationInput {
  workspaceId: WorkspaceId;
  userId: UserId;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}
