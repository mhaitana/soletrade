import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { NotificationId, UserId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * In-app notifications (Phase 11c). Per-user within a workspace: every row is
 * addressed to one recipient (`userId`), so the bell + `/notifications` page are
 * scoped `workspaceId = ? AND userId = ?` (IDOR-safe across users AND workspaces,
 * mirroring `ai_conversations`). Customer-facing events stay email-only; this
 * table holds merchant-facing signals (quote accepted/declined, invoice paid/
 * overdue, quote expired) that warrant a bell badge.
 *
 * `type` is a text slug from a notification-type set (not an enum — so the set can
 * grow without a migration). `entityType`/`entityId` are an optional soft link to
 * the entity the notification is about (e.g. `entityType = "invoice"`,
 * `entityId = <invoice id>`), no FK — cross-module decoupling, mirroring
 * `files.entityId`. `readAt` is null until the recipient marks it read.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().$type<NotificationId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => users.id),
    /** Notification-type slug (e.g. "quote.accepted", "invoice.paid"). */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Soft link: the kind of entity this notification is about. */
    entityType: text("entity_type"),
    /** Soft link: the id of the entity this notification is about (no FK). */
    entityId: uuid("entity_id"),
    /** Null = unread; a timestamp = read. */
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Primary list view is "newest first" for the recipient.
    index("notifications_workspace_user_created_idx").on(t.workspaceId, t.userId, t.createdAt),
    // Unread count lookup.
    index("notifications_workspace_user_read_idx").on(t.workspaceId, t.userId, t.readAt),
  ],
);
