import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AuditLogId, UserId, WorkspaceId } from "@/shared/types/ids";

/**
 * Audit log — sensitive mutations only (billing, members, module changes, authz
 * failures). Distinct from the activity feed: append-only, no soft delete, never
 * shown to end users directly.
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().$type<AuditLogId>().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().$type<WorkspaceId>(),
  actorUserId: uuid("actor_user_id").$type<UserId>(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  ip: text("ip"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
