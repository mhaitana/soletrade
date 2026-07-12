import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, unwrap, unwrapCount } from "@/server/db/helpers";
import { can, type Permission } from "@/platform/permissions";
import { branded, type NotificationId, type UserId, type WorkspaceId } from "@/shared/types/ids";

/**
 * In-app notification store (Phase 11c). Per-user within a workspace: every query
 * filters `workspaceId = ? AND userId = ?` so a member can't read or mutate another
 * member's notifications (IDOR-safe across users AND workspaces, mirroring
 * `ai_conversations`). The route/action layer is the only caller; it always passes
 * the session-resolved ids - never a client-supplied id without an ownership check.
 *
 * Writes come from event subscribers in `index.ts` (merchant-facing events). Reads
 * come from the bell + `/notifications` page.
 */

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

/** Cursor for keyset pagination (createdAt desc + id desc tiebreaker). */
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

const NOTIFICATION_COLUMNS =
  "id, workspace_id, user_id, type, title, body, entity_type, entity_id, read_at, created_at";

/** Maps a snake_case PostgREST notifications row to the camelCase `NotificationRow`. */
function toNotificationRow(r: {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}): NotificationRow {
  return {
    id: branded<"NotificationId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    userId: branded<"UserId">(r.user_id),
    type: r.type,
    title: r.title,
    body: r.body,
    entityType: r.entity_type,
    entityId: r.entity_id,
    // PostgREST returns timestamptz as ISO `string`; convert to Date to preserve
    // the `Date | null` contract consumers (the bell + /notifications) rely on.
    readAt: r.read_at ? parsePgTimestamp(r.read_at) : null,
    createdAt: parsePgTimestamp(r.created_at),
  };
}

/**
 * Insert one in-app notification addressed to a single recipient. Used by the
 * event subscribers (one row per qualifying member). Best-effort: the caller
 * wraps in try/catch so a DB hiccup can't break the event bus.
 */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationId> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("notifications")
      .insert({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entity_type: input.entityType,
        entity_id: input.entityId,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create notification.");
  return branded<"NotificationId">(row.id);
}

/**
 * List a user's notifications in a workspace, newest first. Always scoped to
 * `workspaceId AND userId` (IDOR-safe). Optional `unreadOnly` + keyset cursor.
 */
export async function listNotifications(
  workspaceId: WorkspaceId,
  userId: UserId,
  opts: NotificationListOptions = {},
): Promise<NotificationPage> {
  const supabase = getDataClient();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);
  if (opts.unreadOnly) query = query.is("read_at", null);
  if (opts.before) {
    // Keyset: (created_at, id) strictly < before - created_at < cursor OR
    // (created_at = cursor AND id < cursor). PostgREST expresses this as an `or`
    // with a nested `and(...)` for the tiebreaker. `opts.before.createdAt` is the
    // raw µs-precision ISO string (see NotificationCursor) so the comparison is exact.
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
  const items = pageRows.map(toNotificationRow);
  const last = pageRows[pageRows.length - 1];
  // Cursor carries the raw `created_at` string (µs precision) - NOT a Date.
  const nextCursor: NotificationCursor | null =
    hasMore && last ? { createdAt: last.created_at, id: branded<"NotificationId">(last.id) } : null;
  return { items, nextCursor };
}

/** Count a user's unread notifications in a workspace (bell badge). */
export async function unreadCount(workspaceId: WorkspaceId, userId: UserId): Promise<number> {
  const supabase = getDataClient();
  return unwrapCount(
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("read_at", null),
  );
}

/**
 * Mark a single notification read. Workspace + user scoped (IDOR-safe - a
 * cross-user id is a no-op). Returns true if a row was updated.
 */
export async function markRead(
  workspaceId: WorkspaceId,
  userId: UserId,
  id: NotificationId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("read_at", null)
      .select("id"),
  );
  return rows.length > 0;
}

/** Mark all of a user's unread notifications in a workspace as read. */
export async function markAllRead(workspaceId: WorkspaceId, userId: UserId): Promise<number> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .is("read_at", null)
      .select("id"),
  );
  return rows.length;
}

/**
 * Resolve the active members of a workspace who hold a given permission
 * (e.g. `manage:quote`), returning their ids. Used by the event subscribers to
 * fan out one in-app row per qualifying merchant. Uses the pure `can()` from the
 * permissions platform (no DB permission table - roles carry the grants).
 */
export async function memberIdsWithPermission(
  workspaceId: WorkspaceId,
  permission: Permission,
): Promise<UserId[]> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null),
  );
  return rows.filter((r) => can(r.role, permission)).map((r) => branded<"UserId">(r.user_id));
}
