import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { aiConversations, aiMessages } from "@/server/db/schema";
import type { AiConversationId, UserId, WorkspaceId } from "@/shared/types/ids";

/**
 * AI assistant conversation persistence (Phase 10). Per-user within a workspace:
 * every query filters `workspaceId = ? AND userId = ?` so a member can't read or
 * mutate another member's chats (IDOR-safe across workspaces AND users). The
 * route handler is the only caller; it always passes the session-resolved
 * `workspaceId` + `userId` — never a client-supplied id without an ownership check.
 *
 * Only `user` and `assistant` text rows are stored (tool calls/results are not
 * persisted — the assistant re-derives real data each turn via read-only tools).
 */

export interface ConversationSummary {
  id: AiConversationId;
  title: string;
  updatedAt: Date;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface Conversation extends ConversationSummary {
  /** Whether write-tools are offered in this conversation (Phase 11d). Default false. */
  writeEnabled: boolean;
  messages: ConversationMessage[];
}

/** List a user's conversations in a workspace, most-recently-active first. */
export async function listConversations(
  workspaceId: WorkspaceId,
  userId: UserId,
  opts: { limit?: number } = {},
): Promise<ConversationSummary[]> {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(and(eq(aiConversations.workspaceId, workspaceId), eq(aiConversations.userId, userId)))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt }));
}

/**
 * Load one conversation with its messages, oldest-first. Returns `null` when the
 * conversation doesn't exist OR isn't owned by this user in this workspace — the
 * caller maps that to a 404 (IDOR-safe: no leaking that it belongs to someone else).
 */
export async function getConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
): Promise<Conversation | null> {
  const db = getDb();
  const [conv] = await db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      writeEnabled: aiConversations.writeEnabled,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.workspaceId, workspaceId),
        eq(aiConversations.userId, userId),
      ),
    )
    .limit(1);
  if (!conv) return null;

  const msgs = await db
    .select({
      role: aiMessages.role,
      content: aiMessages.content,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.createdAt))
    .limit(1000);

  return {
    id: conv.id,
    title: conv.title,
    writeEnabled: conv.writeEnabled,
    updatedAt: conv.updatedAt,
    messages: msgs.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
  };
}

/** Create a conversation owned by this user in this workspace. */
export async function createConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  title?: string,
): Promise<AiConversationId> {
  const db = getDb();
  const [row] = await db
    .insert(aiConversations)
    .values({ workspaceId, userId, title: title ?? undefined })
    .returning({ id: aiConversations.id });
  if (!row) throw new Error("Failed to create AI conversation.");
  return row.id;
}

/**
 * Append a message to a conversation and bump its `updatedAt`. Verifies ownership
 * first (IDOR-safe) — a no-op/throw if the conversation isn't this user's in this
 * workspace. Throws on a missing conversation so the caller surfaces a 404/403
 * rather than silently writing to a row the user doesn't own.
 */
export async function appendMessage(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  input: { role: "user" | "assistant"; content: string },
): Promise<void> {
  const db = getDb();
  const [owned] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.workspaceId, workspaceId),
        eq(aiConversations.userId, userId),
      ),
    )
    .limit(1);
  if (!owned) {
    throw new Error("AI conversation not found for this user in this workspace.");
  }
  await db.insert(aiMessages).values({
    conversationId,
    role: input.role,
    content: input.content,
  });
  await db
    .update(aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId));
}

/** Hard-delete a conversation (cascades its messages). IDOR-safe ownership filter. */
export async function deleteConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
): Promise<void> {
  const db = getDb();
  await db
    .delete(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.workspaceId, workspaceId),
        eq(aiConversations.userId, userId),
      ),
    );
}

/** Rename a conversation (e.g. derived from the first user message). IDOR-safe. */
export async function renameConversation(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  title: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(aiConversations)
    .set({ title, updatedAt: new Date() })
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.workspaceId, workspaceId),
        eq(aiConversations.userId, userId),
      ),
    );
}

/**
 * Toggle write-tools for a conversation (Phase 11d). The hard opt-in boundary: write
 * tools are only offered when this is `true` AND the role holds `manage:R` AND the
 * module is installed. IDOR-safe ownership filter — a cross-user/cross-workspace id
 * updates zero rows (no leaking that it belongs to someone else). Bumps `updatedAt`
 * so the conversation jumps to the top of the sidebar.
 */
export async function setConversationWriteEnabled(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(aiConversations)
    .set({ writeEnabled: enabled, updatedAt: new Date() })
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.workspaceId, workspaceId),
        eq(aiConversations.userId, userId),
      ),
    );
}
