import { setEventPersister } from "@/server/events";
import { getDb } from "@/server/db";
import { activityEvents } from "@/server/db/schema";

/**
 * Server bootstrap. Runs once on startup. Wires the event bus persister so
 * every published event is recorded in the activity feed.
 */
export async function register(): Promise<void> {
  setEventPersister(async (event) => {
    const db = getDb();
    await db.insert(activityEvents).values({
      type: event.type,
      workspaceId: event.workspaceId,
      actorUserId: event.actorUserId,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
    });
  });
}
