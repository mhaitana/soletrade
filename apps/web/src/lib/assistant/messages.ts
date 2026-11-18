import type { UIMessage } from "ai";
import { assistantToolInfo, readToolCardFields } from "@/lib/assistant/tool-catalog";

/**
 * hAI chat messages as the chat shows them. Browser-safe: the server stores and streams
 * these, and the web chat renders them.
 *
 * A stored message keeps every part the AI SDK produced (text, tool calls with their
 * results and approval state) plus one `data-actionPreview` part per proposed change. The
 * preview is resolved on the server from the server's own copy of the tool call, so an
 * approval card never shows numbers the browser made up.
 */

/** What an approval card shows before anything runs. */
export interface ActionPreview {
  /** e.g. "Send invoice INV-2026-0007". */
  title: string;
  /** Facts to check before approving, e.g. "To: Acme (ap@acme.com)", "Total: $1,100.00". */
  details: string[];
  /** What happens if approved, e.g. "Emails ap@acme.com the invoice with a payment link." */
  consequence?: string;
  /** The change reaches someone outside the workspace, or cannot be undone. */
  caution?: "sends-message" | "cannot-undo";
}

export type HaiDataParts = { actionPreview: ActionPreview };
export type HaiUIMessage = UIMessage<unknown, HaiDataParts>;
export type HaiMessagePart = HaiUIMessage["parts"][number];

/** A message as stored: older rows have text only and no parts. */
export interface StoredHaiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: unknown[] | null;
}

/** The message's text: its text parts joined, in order. */
export function messageText(parts: readonly unknown[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const { type, text } = part as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string" && text.trim()) texts.push(text);
  }
  return texts.join("\n\n");
}

/** A stored message as a chat message. Rows saved before parts existed become one text part. */
export function storedToUIMessage(message: StoredHaiMessage): HaiUIMessage {
  const parts =
    Array.isArray(message.parts) && message.parts.length > 0
      ? (message.parts as HaiMessagePart[])
      : ([{ type: "text", text: message.content }] as HaiMessagePart[]);
  return { id: message.id, role: message.role, parts };
}

/** A tool call part in a stored or streamed message, read without trusting its shape. */
export interface HaiToolCallPart {
  type: string;
  toolName: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string; isAutomatic?: boolean };
}

/** The tool call parts of a message (`tool-<name>` and `dynamic-tool` parts). */
export function toolCallParts(message: { parts: readonly unknown[] }): HaiToolCallPart[] {
  const calls: HaiToolCallPart[] = [];
  for (const raw of message.parts) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as Record<string, unknown>;
    const type = typeof part.type === "string" ? part.type : "";
    const toolName =
      type === "dynamic-tool"
        ? typeof part.toolName === "string"
          ? part.toolName
          : ""
        : type.startsWith("tool-")
          ? type.slice("tool-".length)
          : "";
    if (!toolName || typeof part.toolCallId !== "string" || typeof part.state !== "string") {
      continue;
    }
    calls.push({ ...(part as object), type, toolName } as HaiToolCallPart);
  }
  return calls;
}

/** The server's preview for one proposed change, if the message carries one. */
export function actionPreviewFor(
  message: { parts: readonly unknown[] },
  toolCallId: string,
): ActionPreview | null {
  for (const raw of message.parts) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as { type?: unknown; id?: unknown; data?: unknown };
    if (part.type !== "data-actionPreview" || part.id !== toolCallId) continue;
    const data = part.data as Partial<ActionPreview> | undefined;
    if (!data || typeof data.title !== "string") return null;
    return {
      title: data.title,
      details: Array.isArray(data.details)
        ? data.details.filter((d): d is string => typeof d === "string")
        : [],
      ...(typeof data.consequence === "string" ? { consequence: data.consequence } : {}),
      ...(data.caution === "sends-message" || data.caution === "cannot-undo"
        ? { caution: data.caution }
        : {}),
    };
  }
  return null;
}

/** A change waiting for the user's yes or no. */
export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  preview: ActionPreview | null;
}

/** The changes in this message that are still waiting for a decision. */
export function pendingApprovals(message: { parts: readonly unknown[] }): PendingApproval[] {
  return toolCallParts(message)
    .filter(
      (part) =>
        part.state === "approval-requested" && part.approval?.id && !part.approval.isAutomatic,
    )
    .map((part) => ({
      approvalId: part.approval!.id,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      preview: actionPreviewFor(message, part.toolCallId),
    }));
}

/** The part's tool name, for `tool-<name>` and `dynamic-tool` parts; null for other parts. */
export function toolNameOf(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as { type?: unknown; toolName?: unknown; toolCallId?: unknown };
  if (typeof record.type !== "string" || typeof record.toolCallId !== "string") return null;
  if (record.type === "dynamic-tool")
    return typeof record.toolName === "string" ? record.toolName : null;
  return record.type.startsWith("tool-") ? record.type.slice("tool-".length) : null;
}

/** Return the message with each tool call part passed through `update` (others unchanged). */
export function mapToolParts<M extends { parts: readonly unknown[] }>(
  message: M,
  update: (part: Record<string, unknown>, toolName: string) => Record<string, unknown>,
): M {
  return {
    ...message,
    parts: message.parts.map((raw) => {
      const toolName = toolNameOf(raw);
      return toolName ? update(raw as Record<string, unknown>, toolName) : raw;
    }),
  };
}

const FINISHED_TOOL_STATES = new Set(["output-available", "output-error", "output-denied"]);

/**
 * True when the message changed something: a write tool call that ran without reporting an
 * error. A tool missing from the catalogue counts as a write.
 */
export function messageMadeChanges(message: { parts: readonly unknown[] }): boolean {
  return toolCallParts(message).some(
    (part) =>
      assistantToolInfo(part.toolName).kind === "write" &&
      part.state === "output-available" &&
      !readToolCardFields(part.output).error,
  );
}

/**
 * Plain text for a stored message: its text, or for a reply that is only tool calls, a
 * short description of them (older app builds show this text and nothing else).
 */
export function messageSummary(message: { parts: readonly unknown[] }): string {
  const text = messageText(message.parts);
  if (text) return text;
  const lines = toolCallParts(message).map((part) => {
    const info = assistantToolInfo(part.toolName);
    const preview = actionPreviewFor(message, part.toolCallId);
    const label = preview?.title ?? info.running;
    if (part.state === "approval-requested") return `Waiting for your approval: ${label}.`;
    if (part.state === "output-denied") return `Not done: ${label}.`;
    if (part.state === "output-error") return `Failed: ${label}.`;
    if (part.state === "output-available") {
      const error = readToolCardFields(part.output).error;
      return error ? `Failed: ${label}.` : `${info.done}.`;
    }
    return `${info.running}.`;
  });
  return lines.join("\n");
}

/**
 * The conversation as the model should see it:
 * - data parts (approval previews) are dropped; they are for the person, not the model;
 * - unfinished tool calls are dropped (they have no result to pair with);
 * - a finished call to a tool that is not offered this turn (for example after changes
 *   were turned off) becomes a one-line note, so the model knows what happened without
 *   seeing a call to a tool it does not have;
 * - an approval that was decided but has not run yet is kept only in the last message,
 *   which is the one being continued;
 * - messages left with nothing to say are dropped.
 */
export function prepareModelHistory<
  M extends { id: string; role: string; parts: readonly unknown[] },
>(messages: readonly M[], availableTools: ReadonlySet<string>): M[] {
  const lastIndex = messages.length - 1;
  const prepared: M[] = [];
  messages.forEach((message, index) => {
    const parts: unknown[] = [];
    for (const raw of message.parts) {
      if (!raw || typeof raw !== "object") continue;
      const type = (raw as { type?: unknown }).type;
      if (typeof type !== "string") continue;
      if (type.startsWith("data-")) continue;
      const toolName = toolNameOf(raw);
      if (!toolName) {
        parts.push(raw);
        continue;
      }
      const state = (raw as { state?: unknown }).state;
      const finished = typeof state === "string" && FINISHED_TOOL_STATES.has(state);
      const decided = state === "approval-responded" && index === lastIndex;
      if (availableTools.has(toolName)) {
        if (finished || decided) parts.push(raw);
        continue;
      }
      if (!finished) continue;
      const info = assistantToolInfo(toolName);
      const card = readToolCardFields((raw as { output?: unknown }).output);
      const note =
        state === "output-denied"
          ? `(Earlier, this was not done: ${info.running.toLowerCase()}.)`
          : state === "output-error" || card.error
            ? `(Earlier, this failed: ${info.running.toLowerCase()}.)`
            : `(Earlier: ${info.done.toLowerCase()}${card.recordLabel ? ` ${card.recordLabel}` : ""}.)`;
      parts.push({ type: "text", text: note });
    }
    const hasContent = parts.some((part) => (part as { type: string }).type !== "step-start");
    if (hasContent) prepared.push({ ...message, parts });
  });
  return prepared;
}
