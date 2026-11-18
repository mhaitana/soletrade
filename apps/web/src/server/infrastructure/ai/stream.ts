import "server-only";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  UI_MESSAGE_STREAM_HEADERS,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamWriter,
} from "ai";

/**
 * Streaming primitives for the AI assistant (Phase 10). Two paths:
 *
 * - **Real providers** (`anthropic`/`openai`): `streamAssistantTurn` runs the AI SDK
 *   `streamText` tool-calling loop (step-bounded, every tool call checked first) and
 *   returns its UI-message stream response. The caller stores the reply in `onEnd`.
 * - **Mock provider**: `streamMockAssistantTurn` emits a single text part from a
 *   pre-computed string (the route builds it by calling the `getWorkspaceOverview`
 *   tool's execute against real workspace data - so local dev/tests show real
 *   numbers without an API key and without running a tool-calling loop).
 *
 * Both paths set `X-Conversation-Id` on the response so the client can capture a
 * newly-created conversation's id (the route creates the conversation server-side
 * when the client sends no `conversationId`) and update the URL for subsequent sends.
 */

/** How the turn's own code treats one tool call (see `toolApproval` on `streamText`). */
export type AssistantToolApproval =
  "not-applicable" | "user-approval" | { type: "denied"; reason: string };

/** What the stream reports when it ends, so the caller can store the reply. */
export interface AssistantTurnEnd {
  /** The assistant message as the chat shows it (new, or the continued one). */
  responseMessage: UIMessage;
  /** True when the turn continued the last assistant message (after an approval). */
  isContinuation: boolean;
  isAborted: boolean;
}

export interface StreamAssistantTurnOptions {
  model: LanguageModel;
  system: string;
  /**
   * The conversation as the chat shows it. Ends with the user's message, or with the
   * assistant message to continue once the user has approved or declined its changes.
   */
  messages: UIMessage[];
  /** The model's view of the same conversation (already windowed and cleaned). */
  modelMessages: ModelMessage[];
  tools: ToolSet;
  /** Decides each tool call; may write data parts (such as an approval preview) first. */
  toolApproval: (
    toolCall: { toolCallId: string; toolName: string; input: unknown },
    writer: UIMessageStreamWriter,
  ) => Promise<AssistantToolApproval>;
  conversationId: string;
  /** Called once the stream ends, with the full reply to store. */
  onEnd: (end: AssistantTurnEnd) => Promise<void> | void;
  /** Labels for the per-call usage log line. Identifiers only, never message content. */
  usage?: { workspaceId: string; surface: string };
  /**
   * Forwarded to `streamText` so an aborted client request (user navigates away,
   * cancels) tears down the upstream model call instead of billing a full
   * generation whose output no one will read.
   */
  abortSignal?: AbortSignal;
}

/**
 * Extract a readable message from an unknown error so the workspace admin can see
 * the real cause (a missing API key, an upstream 401, a tool-execution failure) in
 * the chat UI. This is the user's own workspace tool, so surfacing provider detail
 * is appropriate - the AI SDK's default `onError` hides it behind "An error occurred."
 */
export function assistantErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "Assistant error.";
  if (typeof error === "string") return error;
  return "Assistant error.";
}

/**
 * Upper bound on generated tokens per model step. Chat answers are short; this stops a
 * runaway generation from running to the model's much larger default. On models that
 * reason before answering, that reasoning counts toward the same budget.
 */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 8192;

function streamHeaders(conversationId: string): Record<string, string> {
  return { ...UI_MESSAGE_STREAM_HEADERS, "X-Conversation-Id": conversationId };
}

async function reportTurnEnd(
  onEnd: (end: AssistantTurnEnd) => Promise<void> | void,
  end: AssistantTurnEnd,
): Promise<void> {
  try {
    await onEnd(end);
  } catch (err) {
    // The reply was already shown; a storage failure is logged rather than thrown into a
    // stream that has finished.
    console.error("[assistant] could not store the reply:", err);
  }
}

/**
 * Stream one assistant turn from a real provider: the `streamText` tool loop with every
 * tool call passed through `toolApproval` first. A call that needs the user's approval
 * pauses the turn; the next request continues the same assistant message once the user
 * has decided (the SDK checks the approval again before running anything).
 *
 * `onEnd` receives the whole reply (text, tool calls and their state, data parts) so the
 * caller stores exactly what the user saw. `onError` surfaces the real upstream error
 * (provider 401, missing key, tool throw) instead of the SDK's generic "An error occurred.".
 */
export function streamAssistantTurn(opts: StreamAssistantTurnOptions): Response {
  const stream = createUIMessageStream({
    originalMessages: opts.messages,
    generateId: () => crypto.randomUUID(),
    execute: ({ writer }) => {
      const result = streamText({
        model: opts.model,
        instructions: opts.system,
        messages: opts.modelMessages,
        tools: opts.tools,
        toolApproval: async ({ toolCall }) =>
          opts.toolApproval(
            { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, input: toolCall.input },
            writer,
          ),
        // Bound the tool-calling loop (≤6 steps) so a runaway agent can't spin.
        stopWhen: isStepCount(6),
        maxOutputTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
        // Abort the upstream model call when the client disconnects (saves tokens/latency).
        abortSignal: opts.abortSignal,
        onEnd: ({ steps, totalUsage, finishReason, response }) => {
          // One line per model call so spend can be attributed before a usage ledger exists.
          console.info(
            "[assistant] usage",
            JSON.stringify({
              workspaceId: opts.usage?.workspaceId ?? null,
              surface: opts.usage?.surface ?? null,
              conversationId: opts.conversationId,
              model: response?.modelId ?? null,
              finishReason,
              steps: steps.length,
              inputTokens: totalUsage.inputTokens ?? null,
              cacheReadTokens: totalUsage.inputTokenDetails?.cacheReadTokens ?? null,
              outputTokens: totalUsage.outputTokens ?? null,
              totalTokens: totalUsage.totalTokens ?? null,
            }),
          );
        },
      });
      writer.merge(toUIMessageStream({ stream: result.stream }));
    },
    onEnd: ({ responseMessage, isContinuation, isAborted }) =>
      reportTurnEnd(opts.onEnd, { responseMessage, isContinuation, isAborted }),
    onError: (error) => {
      console.error("[assistant] stream error:", error);
      return assistantErrorMessage(error);
    },
  });
  return createUIMessageStreamResponse({ stream, headers: streamHeaders(opts.conversationId) });
}

/**
 * Return a UI-message stream that immediately errors with `error` - used when the
 * real-provider path fails before streaming starts (e.g. `getAIModel()` throws
 * because the provider API key is unset). Emitting a proper error part (rather than
 * a plain JSON 500) keeps the client on the same `useChat` error path, so the real
 * message shows in the chat instead of an opaque transport/parse failure.
 */
export function streamAssistantError(error: unknown, conversationId: string): Response {
  const stream = createUIMessageStream({
    execute: () => {
      throw error;
    },
    onError: (e) => {
      console.error("[assistant] failed to start stream:", e);
      return assistantErrorMessage(e);
    },
  });
  return createUIMessageStreamResponse({ stream, headers: streamHeaders(conversationId) });
}

/**
 * Stream a pre-computed mock reply (no model, no tool loop): the route has already produced
 * `text` from real workspace data. Emits the chunks a real stream would, so the client
 * treats it identically, and stores the reply through the same `onEnd` as a real turn.
 */
export function streamMockAssistantTurn(opts: {
  messages: UIMessage[];
  text: string;
  conversationId: string;
  /** Optional deterministic safe UI tool emitted by the no-key mock provider. */
  tool?: { name: string; input: unknown; output: unknown };
  onEnd: (end: AssistantTurnEnd) => Promise<void> | void;
}): Response {
  const stream = createUIMessageStream({
    originalMessages: opts.messages,
    generateId: () => crypto.randomUUID(),
    execute: ({ writer }) => {
      const partId = crypto.randomUUID();
      const write = (part: UIMessageChunk) => writer.write(part);
      write({ type: "start" });
      // Mark the step like a real model stream does. The chat looks at the latest step
      // to decide whether approvals still need sending; without this marker a reply that
      // continued after a decision looked like it was still waiting to send it.
      write({ type: "start-step" });
      if (opts.tool) {
        const toolCallId = crypto.randomUUID();
        write({
          type: "tool-input-available",
          toolCallId,
          toolName: opts.tool.name,
          input: opts.tool.input,
        });
        write({
          type: "tool-output-available",
          toolCallId,
          output: opts.tool.output,
        });
      }
      write({ type: "text-start", id: partId });
      write({ type: "text-delta", id: partId, delta: opts.text });
      write({ type: "text-end", id: partId });
      write({ type: "finish-step" });
      write({ type: "finish" });
    },
    onEnd: ({ responseMessage, isContinuation, isAborted }) =>
      reportTurnEnd(opts.onEnd, { responseMessage, isContinuation, isAborted }),
  });
  return createUIMessageStreamResponse({ stream, headers: streamHeaders(opts.conversationId) });
}
