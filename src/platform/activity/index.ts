import "server-only";
import { getDb } from "@/server/db";
import { activityEvents } from "@/server/db/schema";
import type { ActivityEventId, UserId, WorkspaceId } from "@/shared/types/ids";

export interface ActivityInput {
  type: string;
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Write an activity feed event directly. Most activity should be emitted via
 * the event bus (`server/events` `publishEvent`), which persists automatically.
 * This helper exists for the rare case where an activity row is needed without
 * dispatching subscribers.
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
