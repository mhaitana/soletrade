import "server-only";
import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { activityEvents, users } from "@/server/db/schema";
import type { ActivityEventId, UserId, WorkspaceId } from "@/shared/types/ids";

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
  /** Actor display name (resolved via left join on users). null when no actor. */
  actorFullName: string | null;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** Cursor for keyset pagination (createdAt desc + id desc tiebreaker). */
export interface ActivityCursor {
  createdAt: Date;
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

/**
 * Write an activity feed event directly. Most activity should be emitted via
 * the event bus (`server/events` `publishEvent`), which persists automatically
 * via the persister wired in `src/instrumentation.ts`. This helper exists for
 * the rare case where an activity row is needed without dispatching subscribers.
 */
export async function writeActivity(input: ActivityInput): Promise<ActivityEventId> {
  const db = getDb();
  const rows = await db
    .insert(activityEvents)
    .values({
      type: input.type,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    })
    .returning({ id: activityEvents.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to write activity event");
  return row.id;
}

/**
 * List activity for a workspace, newest first. Always scoped to the workspace
 * (IDOR-safe — never returns another workspace's events). Optional filters by
 * type / entity, and keyset cursor pagination.
 */
export async function listActivity(
  workspaceId: WorkspaceId,
  opts: ActivityListOptions = {},
): Promise<ActivityPage> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const conditions: (SQL | undefined)[] = [eq(activityEvents.workspaceId, workspaceId)];

  if (opts.types && opts.types.length > 0) {
    conditions.push(inArray(activityEvents.type, opts.types));
  }
  if (opts.entityType) {
    conditions.push(eq(activityEvents.entityType, opts.entityType));
  }
  if (opts.entityId) {
    conditions.push(eq(activityEvents.entityId, opts.entityId));
  }
  if (opts.before) {
    // Keyset: createdAt < cursor OR (createdAt = cursor AND id < cursor.id)
    conditions.push(
      or(
        lt(activityEvents.createdAt, opts.before.createdAt),
        and(
          eq(activityEvents.createdAt, opts.before.createdAt),
          lt(activityEvents.id, opts.before.id),
        ),
      ),
    );
  }

  const rows = await db
    .select({
      id: activityEvents.id,
      type: activityEvents.type,
      workspaceId: activityEvents.workspaceId,
      actorUserId: activityEvents.actorUserId,
      actorFullName: users.fullName,
      actorEmail: users.email,
      entityType: activityEvents.entityType,
      entityId: activityEvents.entityId,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(limit + 1); // +1 to detect a next page without a separate count query.

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    type: r.type,
    workspaceId: r.workspaceId,
    actorUserId: r.actorUserId,
    actorFullName: r.actorFullName,
    actorEmail: r.actorEmail,
    entityType: r.entityType,
    entityId: r.entityId,
    // drizzle's jsonb column infers as `unknown`; cast to the row contract.
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: r.createdAt,
  }));

  const last = items[items.length - 1];
  const nextCursor: ActivityCursor | null =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;

  return { items, nextCursor };
}
