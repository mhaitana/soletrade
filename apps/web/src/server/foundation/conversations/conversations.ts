import type {
  ConversationSummary,
  Conversation,
} from "@/lib/domain/conversations/conversations-types";
export type {
  ConversationSummary,
  ConversationMessage,
  Conversation,
} from "@/lib/domain/conversations/conversations-types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import {
  parsePgTimestamp,
  unwrap,
  unwrapMaybe,
  unwrapVoid,
} from "@/server/infrastructure/db/helpers";
import type { Json } from "@/server/infrastructure/db/types";
import { branded, type AiConversationId, type UserId, type WorkspaceId } from "@/types/ids";

/**
 * AI assistant conversation persistence (Phase 10). Per-user within a workspace:
 * every query filters `workspaceId = ? AND userId = ?` so a member can't read or
 * mutate another member's chats (IDOR-safe across workspaces AND users). The
 * route handler is the only caller; it always passes the session-resolved
 * `workspaceId` + `userId` - never a client-supplied id without an ownership check.
 *
 * One row is one chat message. `parts` keeps every part as the chat showed it (text, tool
 * calls with results and approval state, action previews); `content` keeps the plain text
 * for older app builds. Messages saved before parts were stored have content only.
 */

/** List a user's conversations in a workspace, most-recently-active first. */
export async function listConversations(
  workspaceId: WorkspaceId,
  userId: UserId,
  opts: { limit?: number; offset?: number } = {},
): Promise<ConversationSummary[]> {
  const supabase = getDataClient();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await unwrap(
    supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(Math.max(0, opts.offset ?? 0), Math.max(0, opts.offset ?? 0) + limit - 1),
  );
  return rows.map((r) => ({
    id: branded<"AiConversationId">(r.id),
    title: r.title,
    updatedAt: parsePgTimestamp(r.updated_at),
  }));
}

/** The most messages of one conversation returned by `getConversation`. */
export const CONVERSATION_MESSAGE_LIMIT = 1000;

/**
 * Load one conversation with its messages, oldest-first. A conversation longer than
 * `CONVERSATION_MESSAGE_LIMIT` returns its most recent messages: the query reads
 * newest-first and the result is reversed. (Reading oldest-first with a limit dropped
 * the newest turns instead, including the message the user had just sent.) Returns `null`
 * when the conversation doesn't exist OR isn't owned by this user in this workspace - the
 * caller maps that to a 404 (IDOR-safe: no leaking that it belongs to someone else).
 */
export async function getConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
): Promise<Conversation | null> {
  const supabase = getDataClient();
  const conv = await unwrapMaybe(
    supabase
      .from("ai_conversations")
      .select("id, title, write_enabled, updated_at")
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  );
  if (!conv) return null;

  const msgs = await unwrap(
    supabase
      .from("ai_messages")
      .select("id, role, content, parts, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(CONVERSATION_MESSAGE_LIMIT),
  );
  msgs.reverse();

  return {
    id: branded<"AiConversationId">(conv.id),
    title: conv.title,
    writeEnabled: conv.write_enabled,
    updatedAt: parsePgTimestamp(conv.updated_at),
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      parts: Array.isArray(m.parts) ? (m.parts as unknown[]) : null,
      createdAt: parsePgTimestamp(m.created_at),
    })),
  };
}

/** Create a conversation owned by this user in this workspace. */
export async function createConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  title?: string,
  deterministicId?: AiConversationId,
): Promise<AiConversationId> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("ai_conversations")
      // `title` is NOT NULL with a default ("New conversation"); pass `undefined` (omitted
      // from the payload via JSON.stringify) so the DB default applies when no title given.
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        user_id: userId,
        title: title ?? undefined,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create AI conversation.");
  return branded<"AiConversationId">(row.id);
}

/** A message to store: `parts` as the chat shows them; `content` is derived by the caller. */
export interface MessageInput {
  /** Server-generated id; the database generates one when omitted. */
  id?: string;
  role: "user" | "assistant";
  content: string;
  parts?: unknown[];
}

/** Throw unless the conversation is this user's in this workspace (IDOR-safe). */
async function assertOwned(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
): Promise<void> {
  const owned = await unwrapMaybe(
    getDataClient()
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  );
  if (!owned) {
    throw new Error("AI conversation not found for this user in this workspace.");
  }
}

async function touchConversation(conversationId: AiConversationId): Promise<void> {
  await unwrapVoid(
    getDataClient()
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId),
  );
}

/**
 * Append a message to a conversation and bump its `updatedAt`. Verifies ownership
 * first (IDOR-safe) - a throw if the conversation isn't this user's in this
 * workspace, so the caller surfaces a 404/403 rather than silently writing to a
 * row the user doesn't own. Returns the stored message id.
 */
export async function appendMessage(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  input: MessageInput,
): Promise<string> {
  await assertOwned(workspaceId, userId, conversationId);
  const rows = await unwrap(
    getDataClient()
      .from("ai_messages")
      .insert({
        ...(input.id ? { id: input.id } : {}),
        conversation_id: conversationId,
        role: input.role,
        content: input.content,
        ...(input.parts ? { parts: input.parts as Json } : {}),
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to store the AI message.");
  await touchConversation(conversationId);
  return row.id;
}

/**
 * Replace a stored message's text and parts, e.g. when an approved change finishes and
 * the reply continues in the same message. Scoped to the conversation, which is checked
 * for ownership first; a message id from another conversation updates nothing.
 */
export async function updateMessage(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  messageId: string,
  input: { content: string; parts: unknown[] },
): Promise<void> {
  await assertOwned(workspaceId, userId, conversationId);
  await unwrapVoid(
    getDataClient()
      .from("ai_messages")
      .update({ content: input.content, parts: input.parts as Json })
      .eq("id", messageId)
      .eq("conversation_id", conversationId),
  );
  await touchConversation(conversationId);
}

/** Delete messages from a conversation (regenerating a reply). Ownership-checked. */
export async function deleteMessages(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  messageIds: readonly string[],
): Promise<void> {
  if (messageIds.length === 0) return;
  await assertOwned(workspaceId, userId, conversationId);
  await unwrapVoid(
    getDataClient()
      .from("ai_messages")
      .delete()
      .eq("conversation_id", conversationId)
      .in("id", [...messageIds]),
  );
}

/** Hard-delete a conversation (cascades its messages). IDOR-safe ownership filter. */
export async function deleteConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
): Promise<void> {
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("ai_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId),
  );
}

/** Rename a conversation (e.g. derived from the first user message). IDOR-safe. */
export async function renameConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  title: string,
): Promise<void> {
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("ai_conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId),
  );
}

/**
 * Toggle write-tools for a conversation (Phase 11d). The hard opt-in boundary: write
 * tools are only offered when this is `true` AND the role holds `manage:R` AND the
 * module is installed. IDOR-safe ownership filter - a cross-user/cross-workspace id
 * updates zero rows (no leaking that it belongs to someone else). Bumps `updatedAt`
 * so the conversation jumps to the top of the sidebar.
 */
export async function setConversationWriteEnabled(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  enabled: boolean,
): Promise<void> {
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("ai_conversations")
      .update({ write_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId),
  );
}
