"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import {
  deleteConversation,
  getConversation,
  listConversations,
  setConversationWriteEnabled,
  type Conversation,
  type ConversationSummary,
} from "@/server/application/assistant/services";
import { branded, type AiConversationId } from "@/types/ids";

/**
 * Server actions for the AI assistant page (Phase 10). The streaming exchange itself
 * goes through the `POST /api/assistant` route handler; these actions cover page load
 * (sidebar + active conversation) and sidebar delete. The route creates a conversation
 * lazily on the first send, so there's no "new conversation" action - a plain link to
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
