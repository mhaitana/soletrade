"use client";

import { storedToUIMessage, type HaiUIMessage } from "@/lib/assistant/messages";
import type { MessageRating } from "@/lib/domain/conversations/conversations-types";
import { loadPanelConversationAction } from "@/features/assistant/api/actions";
import { toolCallIdsOf } from "@/features/assistant/hooks/use-hai-tool-navigation";

export interface LoadedConversation {
  id: string;
  title: string;
  writeEnabled: boolean;
  messages: HaiUIMessage[];
  /** The signed-in person's thumbs up / down, by message id. */
  feedback: Record<string, MessageRating>;
  /** Tool calls that already ran: showing them again must not navigate again. */
  settled: ReadonlySet<string>;
}

/** A stored conversation as a chat shows it, or null when it no longer exists. */
export async function loadConversation(id: string): Promise<LoadedConversation | null> {
  const conversation = await loadPanelConversationAction({ conversationId: id });
  if (!conversation) return null;
  const messages = conversation.messages.map(storedToUIMessage);
  return {
    id: conversation.id,
    title: conversation.title,
    writeEnabled: conversation.writeEnabled,
    messages,
    feedback: conversation.feedback,
    settled: toolCallIdsOf(messages),
  };
}
