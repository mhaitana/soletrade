"use server";

import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import {
  deleteConversation,
  getConversation,
  listConversations,
  type Conversation,
  type ConversationSummary,
} from "@/platform/ai";
import { branded, type AiConversationId } from "@/shared/types/ids";

/**
 * Server actions for the AI assistant page (Phase 10). The streaming exchange itself
 * goes through the `POST /api/assistant` route handler; these actions cover page load
 * (sidebar + active conversation) and sidebar delete. The route creates a conversation
 * lazily on the first send, so there's no "new conversation" action — a plain link to
 * `/assistant` (no `?c=`) starts a fresh chat.
 */

export interface AssistantPageData {
  conversations: ConversationSummary[];
  activeConversation: Conversation | null;
}

export async function loadAssistantPage(input: {
  conversationId?: string;
}): Promise<AssistantPageData> {
  const ctx = await requireWorkspaceContext();
  const conversationId = input.conversationId
    ? (branded<"AiConversationId">(input.conversationId) as AiConversationId)
    : null;
  const [conversations, activeConversation] = await Promise.all([
    listConversations(ctx.workspaceId, ctx.user.id),
    conversationId
      ? getConversation(ctx.workspaceId, ctx.user.id, conversationId)
      : Promise.resolve(null),
  ]);
  return { conversations, activeConversation };
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
