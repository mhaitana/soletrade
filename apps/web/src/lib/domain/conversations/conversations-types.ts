import type { AiConversationId } from "@/types/ids";

export interface ConversationSummary {
  id: AiConversationId;
  title: string;
  updatedAt: Date;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  /** The message's plain text. */
  content: string;
  /**
   * Every part of the message as the chat shows it (text, tool calls and their approval
   * state, action previews). Null for messages saved before parts were stored.
   */
  parts: unknown[] | null;
  createdAt: Date;
}

export interface Conversation extends ConversationSummary {
  /** Whether write-tools are offered in this conversation (Phase 11d). Default false. */
  writeEnabled: boolean;
  messages: ConversationMessage[];
}
