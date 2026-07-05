import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { AiConversationId, AiMessageId, UserId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";
import { aiMessageRoleEnum } from "./enums";

/**
 * AI assistant persistence (Phase 10). Conversations are **per-user within a workspace**:
 * every query filters `workspaceId = ? AND userId = ?` so a member can't read another
 * member's chats (IDOR-safe across workspaces AND users). Solo-trader privacy default.
 *
 * Only the user's prompt and the assistant's final text are persisted (`ai_message_role`
 * is `user` | `assistant`). Tool calls + tool results are NOT replayed — the assistant
 * re-derives real data each turn via read-only tools rather than trusting cached tool
 * output. AI chats aren't audit-relevant, so delete is a hard cascade (no soft-delete).
 */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().$type<AiConversationId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Short label for the sidebar. Default until the first exchange suggests a title. */
    title: text("title").notNull().default("New conversation"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("ai_conversations_workspace_user_created_idx").on(t.workspaceId, t.userId, t.createdAt),
  ],
);

/**
 * Messages within a conversation, oldest-first. Cascade-deleted with the parent
 * conversation. `content` is plain text (no markdown persisted — rendering is plain text
 * + `whitespace-pre-wrap` this phase).
 */
export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().$type<AiMessageId>().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .$type<AiConversationId>()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);
