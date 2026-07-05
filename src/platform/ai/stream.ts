import "server-only";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  UI_MESSAGE_STREAM_HEADERS,
  isStepCount,
  type LanguageModel,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

/**
 * Streaming primitives for the AI assistant (Phase 10). Two paths:
 *
 * - **Real providers** (`anthropic`/`openai`): `streamAssistant` runs the AI SDK
 *   `streamText` tool-calling loop (`maxSteps`-bounded) and returns its UI-message
 *   stream response. The caller wires `onFinish` to persist the assistant's text.
 * - **Mock provider**: `streamMockAssistant` emits a single text part from a
 *   pre-computed string (the route builds it by calling the `getWorkspaceOverview`
 *   tool's execute against real workspace data — so local dev/tests show real
 *   numbers without an API key and without running a tool-calling loop).
 *
 * Both paths set `X-Conversation-Id` on the response so the client can capture a
 * newly-created conversation's id (the route creates the conversation server-side
 * when the client sends no `conversationId`) and update the URL for subsequent sends.
 */

export interface StreamAssistantOptions {
  model: LanguageModel;
  system: string;
  /** Conversation history as AI SDK `UIMessage`s (the route builds these from rows). */
  messages: UIMessage[];
  tools: ToolSet;
  conversationId: string;
  /** Persisted with the assistant turn once the stream completes. */
  onFinish: (text: string) => Promise<void> | void;
}

/**
 * Stream a real-provider assistant reply. The `onFinish` callback receives the
 * final step's text once the whole tool-calling loop settles (the caller persists
 * it). Returns the SSE `Response` directly.
 */
export async function streamAssistant(opts: StreamAssistantOptions): Promise<Response> {
  const result = streamText({
    model: opts.model,
    system: opts.system,
    messages: await convertToModelMessages(opts.messages),
    tools: opts.tools,
    // Bound the tool-calling loop (≤6 steps) so a runaway agent can't spin.
    stopWhen: isStepCount(6),
    onFinish: async ({ text }) => {
      if (text) await opts.onFinish(text);
    },
  });
  return result.toUIMessageStreamResponse({
    headers: { ...UI_MESSAGE_STREAM_HEADERS, "X-Conversation-Id": opts.conversationId },
  });
}

/**
 * Stream a pre-computed mock reply as a single text part. No model, no tool loop —
 * the route has already produced `text` from real workspace data. Emits the same
 * chunk sequence a real stream would (`start` → `text-start` → `text-delta` →
 * `text-end` → `finish`) so the client treats it identically.
 */
export function streamMockAssistant(opts: { text: string; conversationId: string }): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      const msgId = crypto.randomUUID();
      const partId = crypto.randomUUID();
      const write = (part: UIMessageChunk) => writer.write(part);
      write({ type: "start", messageId: msgId });
      write({ type: "text-start", id: partId });
      write({ type: "text-delta", id: partId, delta: opts.text });
      write({ type: "text-end", id: partId });
      write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { ...UI_MESSAGE_STREAM_HEADERS, "X-Conversation-Id": opts.conversationId },
  });
}
