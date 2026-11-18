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
  /**
   * What the server keeps with a message besides what the chat shows. For a user message:
   * `context`, the date and page it was sent with. Absent on older messages.
   */
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

export interface Conversation extends ConversationSummary {
  /** Whether write-tools are offered in this conversation (Phase 11d). Default false. */
  writeEnabled: boolean;
  messages: ConversationMessage[];
}

/** A member's verdict on one of hAI's replies. */
export type MessageRating = "up" | "down";
