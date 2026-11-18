"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import {
  deleteConversation,
  getConversation,
  listConversationFeedback,
  listConversationPage,
  renameConversation,
  setConversationWriteEnabled,
  setMessageFeedback,
  type Conversation,
  type ConversationSummary,
  type MessageRating,
} from "@/server/application/assistant/services";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { canAttachReceipts } from "@/lib/assistant/attachments";
import { branded, type AiConversationId } from "@/types/ids";

/**
 * Server actions for the AI assistant page (Phase 10). The streaming exchange itself
 * goes through the `POST /api/assistant` route handler; these actions cover page load
 * (sidebar + active conversation) and sidebar delete. The route creates a conversation
 * lazily on the first send, so there's no "new conversation" action - a plain link to
 * `/assistant` (no `?c=`) starts a fresh chat.
 */

export interface AssistantPageData {
  /** The most recent conversations (one page). */
  conversations: ConversationSummary[];
  /** Older conversations exist beyond that page. */
  hasMoreConversations: boolean;
  activeConversation: Conversation | null;
  /** The signed-in person's thumbs up / down on replies in the active conversation. */
  feedback: Record<string, MessageRating>;
  /** Books is installed and this person may add receipts and files. */
  canAttachReceipts: boolean;
}

/**
 * The member's thumbs up / down in a conversation. A conversation must still open when
 * these cannot be read (for example the web app deployed before the feedback table's
 * migration), so a failure shows no ratings instead of failing the page.
 */
async function readFeedback(
  ...scope: Parameters<typeof listConversationFeedback>
): Promise<Record<string, MessageRating>> {
  try {
    return await listConversationFeedback(...scope);
  } catch (error) {
    console.error("[assistant] feedback unavailable", error);
    return {};
  }
}

export async function loadAssistantPage(input: {
  conversationId?: string;
}): Promise<AssistantPageData> {
  const ctx = await requireWorkspaceContext();
  const conversationId = input.conversationId
    ? (branded<"AiConversationId">(input.conversationId) as AiConversationId)
    : null;
  const [page, activeConversation, feedback, installed] = await Promise.all([
    listConversationPage(ctx.workspaceId, ctx.user.id),
    conversationId
      ? getConversation(ctx.workspaceId, ctx.user.id, conversationId)
      : Promise.resolve(null),
    conversationId
      ? readFeedback(ctx.workspaceId, ctx.user.id, conversationId)
      : Promise.resolve({}),
    getInstalledModules(ctx.workspaceId),
  ]);
  return {
    conversations: page.conversations,
    hasMoreConversations: page.hasMore,
    activeConversation,
    feedback: activeConversation ? feedback : {},
    canAttachReceipts: canAttachReceipts(ctx.role, installed),
  };
}

const deleteSchema = z.object({ conversationId: z.string().uuid() });

export type DeleteConversationResult = { ok: true } | { ok: false; error: string };

export async function deleteConversationAction(input: unknown): Promise<DeleteConversationResult> {
  const ctx = await requireWorkspaceContext();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid conversation id." };
  await deleteConversation(
    ctx.workspaceId,
    ctx.user.id,
    branded<"AiConversationId">(parsed.data.conversationId),
  );
  return { ok: true };
}

const writeEnabledSchema = z.object({
  conversationId: z.string().uuid(),
  enabled: z.boolean(),
});

export type SetWriteEnabledResult = { ok: true; enabled: boolean } | { ok: false; error: string };

/**
 * Toggle write-tools for a conversation (Phase 11d). The hard opt-in boundary: write
 * tools are only offered when this is on. IDOR-safe - `setConversationWriteEnabled`
 * filters by workspace + user, so a cross-user id is a no-op. Revalidates `/assistant`
 * so the toggle reflects immediately. No-op (returns ok with current state) when the
 * conversation doesn't exist for this user - the UI treats it as a fresh conversation.
 */
export async function setWriteEnabledAction(input: unknown): Promise<SetWriteEnabledResult> {
  const ctx = await requireWorkspaceContext();
  const parsed = writeEnabledSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  await setConversationWriteEnabled(
    ctx.workspaceId,
    ctx.user.id,
    branded<"AiConversationId">(parsed.data.conversationId),
    parsed.data.enabled,
  );
  revalidatePath("/assistant");
  return { ok: true, enabled: parsed.data.enabled };
}

const renameSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1, "Enter a name.").max(80, "Keep the name under 80 characters."),
});

export type RenameConversationResult = { ok: true; title: string } | { ok: false; error: string };

/** Rename one of the signed-in person's conversations. IDOR-safe like the other actions. */
export async function renameConversationAction(input: unknown): Promise<RenameConversationResult> {
  const ctx = await requireWorkspaceContext();
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }
  await renameConversation(
    ctx.workspaceId,
    ctx.user.id,
    branded<"AiConversationId">(parsed.data.conversationId),
    parsed.data.title,
  );
  revalidatePath("/assistant");
  return { ok: true, title: parsed.data.title };
}

const listSchema = z.object({
  search: z.string().trim().max(80).optional(),
  offset: z.number().int().min(0).max(10_000).optional(),
});

export interface ConversationListPage {
  conversations: ConversationSummary[];
  /** More conversations follow this page. */
  hasMore: boolean;
}

/**
 * One page of the signed-in person's conversations in this workspace, newest first, for
 * the side panel's History and the assistant page's list. `search` matches titles;
 * `offset` continues a list already on screen.
 */
export async function listConversationsAction(input?: unknown): Promise<ConversationListPage> {
  const ctx = await requireWorkspaceContext();
  const parsed = listSchema.safeParse(input ?? {});
  if (!parsed.success) return { conversations: [], hasMore: false };
  return listConversationPage(ctx.workspaceId, ctx.user.id, {
    search: parsed.data.search || undefined,
    offset: parsed.data.offset,
  });
}

export interface PanelConversation {
  id: string;
  title: string;
  /** Whether hAI may propose changes in this conversation. */
  writeEnabled: boolean;
  /** The signed-in person's thumbs up / down on its replies, by message id. */
  feedback: Record<string, MessageRating>;
  messages: { id: string; role: "user" | "assistant"; content: string; parts: unknown[] | null }[];
}

/**
 * One conversation for the side panel: the one it was showing before the page reloaded,
 * or one picked from its History. Null when it is gone (deleted, or it belongs to another
 * workspace or person).
 */
export async function loadPanelConversationAction(
  input: unknown,
): Promise<PanelConversation | null> {
  const ctx = await requireWorkspaceContext();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return null;
  const conversationId = branded<"AiConversationId">(parsed.data.conversationId);
  const [conversation, feedback] = await Promise.all([
    getConversation(ctx.workspaceId, ctx.user.id, conversationId),
    readFeedback(ctx.workspaceId, ctx.user.id, conversationId),
  ]);
  if (!conversation) return null;
  return {
    id: conversation.id as string,
    title: conversation.title,
    writeEnabled: conversation.writeEnabled,
    feedback,
    messages: conversation.messages.map(({ id, role, content, parts }) => ({
      id,
      role,
      content,
      parts,
    })),
  };
}

const feedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: z.enum(["up", "down"]).nullable(),
  comment: z.string().trim().max(1000).optional(),
});

export type SetMessageFeedbackResult = { ok: true } | { ok: false; error: string };

/**
 * Thumbs up or down on one of hAI's replies, with an optional note; `rating: null` clears
 * it. Only a reply in one of the signed-in person's own conversations can be rated.
 */
export async function setMessageFeedbackAction(input: unknown): Promise<SetMessageFeedbackResult> {
  const ctx = await requireWorkspaceContext();
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const result = await setMessageFeedback(ctx.workspaceId, ctx.user.id, parsed.data);
  if (result === "not-found") return { ok: false, error: "That reply is no longer available." };
  return { ok: true };
}
