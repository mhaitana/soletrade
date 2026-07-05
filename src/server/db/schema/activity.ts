import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ActivityEventId, UserId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";

/**
 * Activity feed events — event-driven (brief §8.3). `type` is a string from the
 * platform event catalog (server/events/catalog) so modules can emit new types
 * without a schema change.
 */
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().$type<ActivityEventId>().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .$type<WorkspaceId>()
    .references(() => workspaces.id),
  actorUserId: uuid("actor_user_id").$type<UserId>(),
  type: text("type").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
