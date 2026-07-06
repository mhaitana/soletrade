import "server-only";
import { and, count, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { notifications, workspaceMembers } from "@/server/db/schema";
import { can, type Permission } from "@/platform/permissions";
import type { NotificationId, UserId, WorkspaceId } from "@/shared/types/ids";

/**
 * In-app notification store (Phase 11c). Per-user within a workspace: every query
 * filters `workspaceId = ? AND userId = ?` so a member can't read or mutate another
 * member's notifications (IDOR-safe across users AND workspaces, mirroring
 * `ai_conversations`). The route/action layer is the only caller; it always passes
 * the session-resolved ids — never a client-supplied id without an ownership check.
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
  createdAt: Date;
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

/**
 * Insert one in-app notification addressed to a single recipient. Used by the
 * event subscribers (one row per qualifying member). Best-effort: the caller
 * wraps in try/catch so a DB hiccup can't break the event bus.
 */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationId> {
  const db = getDb();
  const [row] = await db
    .insert(notifications)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
    })
    .returning({ id: notifications.id });
  if (!row) throw new Error("Failed to create notification.");
  return row.id;
}

function toRow(r: typeof notifications.$inferSelect): NotificationRow {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    userId: r.userId,
    type: r.type,
    title: r.title,
    body: r.body,
    entityType: r.entityType,
    entityId: r.entityId,
    readAt: r.readAt,
    createdAt: r.createdAt,
  };
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
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const conditions: (SQL | undefined)[] = [
    eq(notifications.workspaceId, workspaceId),
    eq(notifications.userId, userId),
  ];
  if (opts.unreadOnly) conditions.push(isNull(notifications.readAt));
  if (opts.before) {
    conditions.push(
      or(
        lt(notifications.createdAt, opts.before.createdAt),
        and(
          eq(notifications.createdAt, opts.before.createdAt),
          lt(notifications.id, opts.before.id),
        ),
      ),
    );
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(toRow);
  const last = items[items.length - 1];
  const nextCursor: NotificationCursor | null =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;
  return { items, nextCursor };
}

/** Count a user's unread notifications in a workspace (bell badge). */
export async function unreadCount(workspaceId: WorkspaceId, userId: UserId): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Mark a single notification read. Workspace + user scoped (IDOR-safe — a
 * cross-user id is a no-op). Returns true if a row was updated.
 */
export async function markRead(
  workspaceId: WorkspaceId,
  userId: UserId,
  id: NotificationId,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length > 0;
}

/** Mark all of a user's unread notifications in a workspace as read. */
export async function markAllRead(workspaceId: WorkspaceId, userId: UserId): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

/**
 * Resolve the active members of a workspace who hold a given permission
 * (e.g. `manage:quote`), returning their ids. Used by the event subscribers to
 * fan out one in-app row per qualifying merchant. Uses the pure `can()` from the
 * permissions platform (no DB permission table — roles carry the grants).
 */
export async function memberIdsWithPermission(
  workspaceId: WorkspaceId,
  permission: Permission,
): Promise<UserId[]> {
  const db = getDb();
  const rows = await db
    .select({ id: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)));
  return rows.filter((r) => can(r.role, permission)).map((r) => r.id);
}
