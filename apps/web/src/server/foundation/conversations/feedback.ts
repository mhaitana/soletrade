import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrap, unwrapMaybe, unwrapVoid } from "@/server/infrastructure/db/helpers";
import type { AiConversationId, UserId, WorkspaceId } from "@/types/ids";
import type { MessageRating } from "@/lib/domain/conversations/conversations-types";
import { truncate } from "@/utils/truncate";

/**
 * Thumbs up or down on hAI's replies. Like the conversations themselves, feedback is per
 * member within a workspace: every query here filters on the workspace and member resolved
 * from the session, and a reply is only rated after its conversation is confirmed to be
 * that member's, so a message id from someone else's conversation changes nothing.
 */

/** The longest reply text kept with a rating. */
const MESSAGE_TEXT_LIMIT = 4000;

export type SetFeedbackResult = "saved" | "cleared" | "not-found";

/**
 * Rate one reply, change the rating, or clear it (`rating: null`). "not-found" when the
 * message is not one of hAI's replies in a conversation this member owns here.
 */
export async function setMessageFeedback(
  workspaceId: WorkspaceId,
  userId: UserId,
  input: { messageId: string; rating: MessageRating | null; comment?: string | null },
): Promise<SetFeedbackResult> {
  const supabase = getDataClient();
  const message = await unwrapMaybe(
    supabase
      .from("ai_messages")
      .select("id, conversation_id, role, content")
      .eq("id", input.messageId)
      .limit(1)
      .maybeSingle(),
  );
  if (!message || message.role !== "assistant") return "not-found";
  const owned = await unwrapMaybe(
    supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", message.conversation_id)
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
  );
  if (!owned) return "not-found";

  if (input.rating === null) {
    await unwrapVoid(
      supabase
        .from("ai_message_feedback")
        .delete()
        .eq("message_id", message.id)
        .eq("user_id", userId)
        .eq("workspace_id", workspaceId),
    );
    return "cleared";
  }

  await unwrapVoid(
    supabase.from("ai_message_feedback").upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        conversation_id: message.conversation_id,
        message_id: message.id,
        rating: input.rating,
        comment: input.comment?.trim() || null,
        message_text: truncate(message.content, MESSAGE_TEXT_LIMIT),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id,user_id" },
    ),
  );
  return "saved";
}

/** This member's ratings in one conversation, by message id. */
export async function listConversationFeedback(
  workspaceId: WorkspaceId,
  userId: UserId,
  conversationId: AiConversationId,
): Promise<Record<string, MessageRating>> {
  const rows = await unwrap(
    getDataClient()
      .from("ai_message_feedback")
      .select("message_id, rating")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .not("message_id", "is", null),
  );
  const ratings: Record<string, MessageRating> = {};
  for (const row of rows) {
    if (row.message_id && (row.rating === "up" || row.rating === "down")) {
      ratings[row.message_id] = row.rating;
    }
  }
  return ratings;
}
