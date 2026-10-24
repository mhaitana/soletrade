import type { AiConversationId } from "@/types/ids";

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
