"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import { messageText, toolCallParts, type HaiUIMessage } from "@/lib/assistant/messages";

/**
 * The hAI chat shared by the assistant page and the side panel.
 *
 * The browser never sends the transcript. Each request says what the person did, and the
 * server works from its stored copy of the conversation:
 * - `message`: a new message (its text only);
 * - `approvals`: Approve or Decline on changes hAI proposed (`{ approvalId, approved }`
 *   only; what the change is comes from the server's own record);
 * - `regenerate`: answer the latest reply again;
 * - `retry`: send the last message again after a request failed.
 */

type Trigger = "submit-message" | "regenerate-message";

export interface HaiPageContext {
  pathname: string;
  search: string;
}

/** The Approve/Decline answers recorded on a message's proposed changes. */
function decisionsIn(message: HaiUIMessage): { approvalId: string; approved: boolean }[] {
  return toolCallParts(message)
    .filter(
      (part) =>
        part.state === "approval-responded" &&
        typeof part.approval?.id === "string" &&
        typeof part.approval.approved === "boolean",
    )
    .map((part) => ({ approvalId: part.approval!.id, approved: part.approval!.approved! }));
}

/** The body of one request to `POST /api/assistant`. Exported for tests. */
export function haiRequestBody(input: {
  conversationId: string | null;
  messages: readonly HaiUIMessage[];
  trigger: Trigger;
  messageId?: string;
  pageContext: HaiPageContext;
}): Record<string, unknown> {
  const { conversationId, messages, trigger, messageId, pageContext } = input;
  const last = messages.at(-1);
  if (trigger === "regenerate-message") {
    // `regenerate({ messageId })` drops that reply locally and asks for a new one.
    if (messageId) return { conversationId, kind: "regenerate", messageId };
    // `regenerate()` with the person's message last: the earlier request failed.
    return {
      conversationId,
      kind: "retry",
      message: last?.role === "user" ? messageText(last.parts) : "",
      pageContext,
    };
  }
  if (last?.role === "assistant") {
    return { conversationId, kind: "approvals", approvals: decisionsIn(last) };
  }
  return {
    conversationId,
    kind: "message",
    message: last ? messageText(last.parts) : "",
    pageContext,
  };
}

/**
 * Send the decisions once every change hAI proposed in its latest step has one. Like the
 * SDK's `lastAssistantMessageIsCompleteWithApprovalResponses`, but a call the server
 * already turned down (`output-denied`) also counts as settled, so one refused call cannot
 * hold the others back.
 */
export function readyToSendApprovals({ messages }: { messages: HaiUIMessage[] }): boolean {
  const message = messages.at(-1);
  if (!message || message.role !== "assistant") return false;
  const lastStep = message.parts.reduce(
    (index, part, i) => (part.type === "step-start" ? i : index),
    -1,
  );
  const calls = message.parts.slice(lastStep + 1).filter(isToolUIPart);
  return (
    calls.some((part) => part.state === "approval-responded") &&
    calls.every(
      (part) =>
        part.state === "approval-responded" ||
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "output-denied",
    )
  );
}

function currentPageContext(): HaiPageContext {
  if (typeof window === "undefined") return { pathname: "", search: "" };
  return { pathname: window.location.pathname, search: window.location.search };
}

export interface UseHaiChatOptions {
  /** Chat instance id; changing it starts a fresh chat. */
  chatId: string;
  /** The stored conversation this chat continues, if any. */
  conversationId: string | null;
  initialMessages?: HaiUIMessage[];
  /** Called once when the server creates the conversation on the first message. */
  onConversationCreated?: (id: string) => void;
  onFinish?: () => void;
}

/**
 * The transport and the conversation id it sends. Built once per chat: the id lives in
 * this closure (not in React state) because requests read it after the chat was created,
 * including the automatic request that follows an approval.
 */
export function createHaiSession(initialId: string | null, onCreated: (id: string) => void) {
  let conversationId = initialId;
  // Decisions already sent. The SDK re-checks `sendAutomaticallyWhen` after every reply,
  // so without this a decision still visible in the reply could be sent a second time.
  const sentDecisions = new Set<string>();
  const transport = new DefaultChatTransport<HaiUIMessage>({
    api: "/api/assistant",
    prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
      const body = haiRequestBody({
        conversationId,
        messages,
        trigger,
        messageId,
        pageContext: currentPageContext(),
      });
      if (body.kind === "approvals" && Array.isArray(body.approvals)) {
        for (const decision of body.approvals as { approvalId: string }[]) {
          sentDecisions.add(decision.approvalId);
        }
      }
      return { body };
    },
    fetch: async (url, init) => {
      const response = await globalThis.fetch(url, init);
      const id = response.headers.get("X-Conversation-Id");
      if (id && conversationId === null) {
        conversationId = id;
        onCreated(id);
      }
      return response;
    },
  });
  return {
    transport,
    setConversationId(id: string | null) {
      conversationId = id;
    },
    /** Send automatically once every change is decided and a decision is not yet sent. */
    readyToSend({ messages }: { messages: HaiUIMessage[] }): boolean {
      const last = messages.at(-1);
      return (
        readyToSendApprovals({ messages }) &&
        !!last &&
        decisionsIn(last).some((decision) => !sentDecisions.has(decision.approvalId))
      );
    },
  };
}

export function useHaiChat(options: UseHaiChatOptions) {
  const [conversationId, setConversationId] = useState<string | null>(options.conversationId);
  const [session] = useState(() =>
    createHaiSession(options.conversationId, (id) => {
      setConversationId(id);
      options.onConversationCreated?.(id);
    }),
  );

  const chat = useChat<HaiUIMessage>({
    id: options.chatId,
    messages: options.initialMessages,
    transport: session.transport,
    sendAutomaticallyWhen: session.readyToSend,
    onFinish: options.onFinish,
  });

  const busy = chat.status === "submitted" || chat.status === "streaming";

  /** Approve or decline one proposed change; the request goes once all are decided. */
  function decide(approvalId: string, approved: boolean): void {
    void chat.addToolApprovalResponse({ id: approvalId, approved });
  }

  /** Try the last exchange again after an error. */
  function retry(): void {
    const last = chat.messages.at(-1);
    if (!last || busy) return;
    chat.clearError();
    if (last.role === "assistant") void chat.regenerate({ messageId: last.id });
    else void chat.regenerate();
  }

  /** Ask for a new answer to the latest reply. */
  function regenerate(messageId: string): void {
    if (busy) return;
    void chat.regenerate({ messageId });
  }

  function send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void chat.sendMessage({ text: trimmed });
  }

  /** Forget the current conversation (the next message starts a new one). */
  function startNew(): void {
    if (busy) void chat.stop();
    session.setConversationId(null);
    setConversationId(null);
    chat.setMessages([]);
    chat.clearError();
  }

  /** Show a stored conversation in this chat, in place of whatever it was showing. */
  function restore(id: string, messages: HaiUIMessage[]): void {
    if (busy) void chat.stop();
    session.setConversationId(id);
    setConversationId(id);
    chat.setMessages(messages);
    chat.clearError();
  }

  return {
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    stop: chat.stop,
    busy,
    conversationId,
    send,
    decide,
    retry,
    regenerate,
    startNew,
    restore,
  };
}
