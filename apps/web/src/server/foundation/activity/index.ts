import type {
  ActivityInput,
  ActivityRow,
  ActivityCursor,
  ActivityListOptions,
  ActivityPage,
} from "@/lib/domain/activity/types";
export type {
  ActivityInput,
  ActivityRow,
  ActivityCursor,
  ActivityListOptions,
  ActivityPage,
} from "@/lib/domain/activity/types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { parsePgTimestamp, unwrap } from "@/server/infrastructure/db/helpers";
import { branded, type ActivityEventId, type WorkspaceId } from "@/types/ids";
import type { Json } from "@/lib/domain/json";

/** Cursor for keyset pagination (createdAt desc + id desc tiebreaker). */

const ACTIVITY_COLUMNS =
  "id, type, workspace_id, actor_user_id, entity_type, entity_id, metadata, created_at, users ( full_name, email )";

/** Maps a snake_case PostgREST activity_events row (+ embedded actor) to `ActivityRow`. */
function toActivityRow(r: {
  id: string;
  type: string;
  workspace_id: string;
  actor_user_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Json | null;
  created_at: string;
  users: { full_name: string | null; email: string } | null;
}): ActivityRow {
  return {
    id: branded<"ActivityEventId">(r.id),
    type: r.type,
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    actorUserId: r.actor_user_id ? branded<"UserId">(r.actor_user_id) : null,
    actorFullName: r.users?.full_name ?? null,
    actorEmail: r.users?.email ?? null,
    entityType: r.entity_type,
    entityId: r.entity_id,
    // PostgREST returns jsonb as the generated `Json` union; cast to the row contract.
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: parsePgTimestamp(r.created_at),
  };
}

/**
 * Write an activity feed event directly. Most activity should be emitted via
 * the event bus (`server/events` `publishEvent`), which persists automatically
 * via the persister wired in `src/instrumentation.ts`. This helper exists for
 * the rare case where an activity row is needed without dispatching subscribers.
 */
export async function writeActivity(input: ActivityInput): Promise<ActivityEventId> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("activity_events")
      .insert({
        type: input.type,
        workspace_id: input.workspaceId,
        actor_user_id: input.actorUserId ?? null,
        entity_type: input.entityType,
        entity_id: input.entityId,
        metadata: (input.metadata ?? null) as Json,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to write activity event");
  return branded<"ActivityEventId">(row.id);
}

/**
 * List activity for a workspace, newest first. Always scoped to the workspace
 * (IDOR-safe - never returns another workspace's events). Optional filters by
 * type / entity, and keyset cursor pagination.
 */
export async function listActivity(
  workspaceId: WorkspaceId,
  opts: ActivityListOptions = {},
): Promise<ActivityPage> {
  const supabase = getDataClient();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let query = supabase
    .from("activity_events")
    .select(ACTIVITY_COLUMNS)
    .eq("workspace_id", workspaceId);

  if (opts.types && opts.types.length > 0) {
    query = query.in("type", opts.types);
  }
  if (opts.entityType) {
    query = query.eq("entity_type", opts.entityType);
  }
  if (opts.entityId) {
    query = query.eq("entity_id", opts.entityId);
  }
  if (opts.before) {
    // Keyset: (created_at, id) strictly < before - created_at < cursor OR
    // (created_at = cursor AND id < cursor). PostgREST expresses this as an `or`
    // with a nested `and(...)` for the tiebreaker. `opts.before.createdAt` is the
    // raw µs-precision ISO string (see ActivityCursor) so the comparison is exact.
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
  const items = pageRows.map(toActivityRow);
  const last = pageRows[pageRows.length - 1];
  // Cursor carries the raw `created_at` string (µs precision) - NOT a Date.
  const nextCursor: ActivityCursor | null =
    hasMore && last
      ? { createdAt: last.created_at, id: branded<"ActivityEventId">(last.id) }
      : null;
  return { items, nextCursor };
}
