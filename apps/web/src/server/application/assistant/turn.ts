import "server-only";
import {
  convertToModelMessages,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { assistantApprovalFor } from "@/lib/assistant/approval-policy";
import {
  mapToolParts,
  messageMadeChanges,
  messageSummary,
  prepareModelHistory,
  storedToUIMessage,
  toolCallParts,
  type HaiUIMessage,
} from "@/lib/assistant/messages";
import { assistantToolInfo, readToolCardFields } from "@/lib/assistant/tool-catalog";
import type { WorkspaceContext } from "@/lib/domain/auth/workspace-context-types";
import type { Conversation } from "@/lib/domain/conversations/conversations-types";
import { buildActionPreview } from "@/server/application/assistant/action-preview";
import {
  ASSISTANT_DAILY_LIMIT_MESSAGE,
  ASSISTANT_DAILY_TURN_LIMIT,
  buildAssistantSystemPrompt,
  selectModelHistory,
} from "@/server/application/assistant/prompt";
import {
  buildAssistantTools,
  buildMockAssistantReply,
  buildMockHaiSafeAction,
} from "@/server/application/assistant/tools";
import {
  appendMessage,
  createConversation,
  deleteMessages,
  updateMessage,
} from "@/server/foundation/conversations/conversations";
import {
  claimToolAction,
  decideToolAction,
  declinePendingToolActions,
  finishToolAction,
  getToolAction,
  listToolActions,
  recordProposedToolAction,
  type ToolActionScope,
} from "@/server/foundation/conversations/tool-actions";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { getAIModel, isMockProvider } from "@/server/infrastructure/ai/provider";
import {
  streamAssistantError,
  streamAssistantTurn,
  streamMockAssistantTurn,
  type AssistantToolApproval,
  type AssistantTurnEnd,
} from "@/server/infrastructure/ai/stream";
import { rateLimit } from "@/server/infrastructure/rate-limit/index";
import type { AiConversationId } from "@/types/ids";

/**
 * One hAI turn, shared by the web chat and the mobile app.
 *
 * A turn is one of:
 * - `message`: the user sent a message;
 * - `approvals`: the user approved or declined the changes hAI proposed in its last reply,
 *   which continues that reply;
 * - `regenerate`: answer the last message again (refused when the reply made changes);
 * - `retry`: the request carrying a message failed. If the message was stored it is
 *   answered; if it never arrived it is taken as a new message, so a retry never stores
 *   the same message twice.
 *
 * Every change hAI proposes waits for the user. The tool name and input that run are the
 * server's stored copy; the client only says yes or no to an approval id. The action ledger
 * (`ai_tool_actions`) makes each approved change run at most once, whatever the client
 * resends. The whole reply (text, tool calls, previews) is stored when the stream ends.
 */

export class AssistantTurnError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "assistant_turn",
  ) {
    super(message);
    this.name = "AssistantTurnError";
  }
}

type PageContext = { pathname: string; search?: string };

export type AssistantTurnInput =
  | { kind: "message"; text: string; pageContext?: PageContext }
  | { kind: "retry"; text: string; pageContext?: PageContext }
  | { kind: "approvals"; decisions: readonly { approvalId: string; approved: boolean }[] }
  | { kind: "regenerate"; messageId?: string };

/**
 * A retry is answered as `regenerate` when the stored conversation ends with that same
 * message (it was saved, then the reply failed), and as a new `message` otherwise.
 */
function resolveRetry(
  input: AssistantTurnInput,
  conversation: Conversation | null,
): Exclude<AssistantTurnInput, { kind: "retry" }> {
  if (input.kind !== "retry") return input;
  const last = conversation?.messages.at(-1);
  if (last?.role === "user" && last.content.trim() === input.text.trim()) {
    return { kind: "regenerate" };
  }
  return {
    kind: "message",
    text: input.text,
    ...(input.pageContext ? { pageContext: input.pageContext } : {}),
  };
}

export interface AssistantTurnOptions {
  ctx: WorkspaceContext;
  surface: "web" | "mobile";
  /** The conversation, already loaded for this user; null starts one (messages only). */
  conversation: Conversation | null;
  input: AssistantTurnInput;
  /** The client can show approval cards. Without them, changes are refused with a reason. */
  approvalsSupported: boolean;
  abortSignal?: AbortSignal;
}

const SKIPPED_REASON = "Not done: you sent a new message instead of approving it.";
const WRITES_OFF_REASON = "Not done: changes are turned off in this conversation.";
const DECLINED_REASON = "You declined this change.";
const MISMATCH_REASON = "This change no longer matches what was proposed, so it was not run.";

/** JSON with sorted keys, so a stored copy compares equal however Postgres ordered it. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const sameInput = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * Settle the changes still open in an assistant message (waiting, or decided but never
 * run) because the conversation moved on. Anything the ledger shows as having run keeps
 * its real outcome; everything else is marked not done.
 */
async function settleOpenApprovals(
  scope: ToolActionScope,
  message: HaiUIMessage,
  reason: string,
): Promise<HaiUIMessage | null> {
  const open = toolCallParts(message).filter(
    (part) => part.state === "approval-requested" || part.state === "approval-responded",
  );
  if (open.length === 0) return null;
  const ids = open.map((part) => part.toolCallId);
  // Decline first: after this nothing listed can start, so the statuses read next are final.
  await declinePendingToolActions(scope, ids);
  const records = await listToolActions(scope, ids);
  return mapToolParts(message, (part) => {
    const id = part.toolCallId as string;
    if (!ids.includes(id)) return part;
    const record = records.get(id);
    if (record?.status === "succeeded") {
      return { ...part, state: "output-available", output: record.result };
    }
    if (record?.status === "failed" || record?.status === "running") {
      return {
        ...part,
        state: "output-error",
        errorText:
          record.status === "failed"
            ? (record.error ?? "The change failed.")
            : "This change may not have finished. Check the record before trying again.",
      };
    }
    const approval = part.approval as { id?: string } | undefined;
    return {
      ...part,
      state: "output-denied",
      approval: { id: approval?.id ?? id, approved: false, reason },
    };
  });
}

/**
 * Wrap every write tool so it runs only as the approved, stored call, and only once. The
 * approval check records each proposed change in the ledger; here the change is claimed
 * (approved -> running) before it runs and its outcome stored after.
 */
function withActionLedger(tools: ToolSet, scope: ToolActionScope): ToolSet {
  const guarded: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) {
    const execute = definition.execute as
      ((input: unknown, options: { toolCallId: string }) => Promise<unknown>) | undefined;
    if (assistantToolInfo(name).kind !== "write" || !execute) {
      guarded[name] = definition;
      continue;
    }
    guarded[name] = {
      ...definition,
      execute: async (input: unknown, options: { toolCallId: string }) => {
        const id = options.toolCallId;
        const record = await getToolAction(scope, id);
        if (!record || record.toolName !== name || !sameInput(record.input, input)) {
          return { error: "This change was not approved, so it was not run." };
        }
        // Already ran (a retried continuation): report the stored result, never run twice.
        if (record.status === "succeeded") return record.result;
        if (!(await claimToolAction(scope, id))) {
          return { error: "This change was already handled." };
        }
        try {
          const result = await execute(input, options);
          const error = readToolCardFields(result).error;
          await finishToolAction(
            scope,
            id,
            error ? { ok: false, error, result } : { ok: true, result },
          );
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : "The change failed.";
          await finishToolAction(scope, id, { ok: false, error: message }).catch((finishErr) =>
            console.error("[assistant] could not record a failed change:", finishErr),
          );
          throw err;
        }
      },
    } as ToolSet[string];
  }
  return guarded;
}

function lastUserText(messages: readonly HaiUIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "user") continue;
    const text = messageSummary(message);
    if (text) return text;
  }
  return "";
}

export async function runAssistantTurn(opts: AssistantTurnOptions): Promise<Response> {
  const { ctx } = opts;
  const input = resolveRetry(opts.input, opts.conversation);
  const mock = isMockProvider();

  // Interim spend guard until usage metering exists: a daily cap on model turns per
  // workspace, checked before anything is stored. The mock provider costs nothing.
  if (
    !mock &&
    !(await rateLimit(`ai:day:${ctx.workspaceId}`, {
      max: ASSISTANT_DAILY_TURN_LIMIT,
      windowMs: 24 * 60 * 60_000,
    }))
  ) {
    throw new AssistantTurnError(429, ASSISTANT_DAILY_LIMIT_MESSAGE, "rate_limited");
  }

  let conversation = opts.conversation;
  if (!conversation) {
    if (input.kind !== "message") {
      throw new AssistantTurnError(404, "Conversation not found.", "not_found");
    }
    const title = input.text.length > 40 ? `${input.text.slice(0, 40)}…` : input.text;
    const id = await createConversation(ctx.workspaceId, ctx.user.id, title);
    conversation = { id, title, updatedAt: new Date(), writeEnabled: false, messages: [] };
  }
  const conversationId: AiConversationId = conversation.id;
  const scope: ToolActionScope = {
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    conversationId,
  };
  const [installedModules, workspace] = await Promise.all([
    getInstalledModules(ctx.workspaceId),
    getWorkspace(ctx.workspaceId),
  ]);
  const tools = mock
    ? {}
    : buildAssistantTools(ctx, installedModules, { writeEnabled: conversation.writeEnabled });

  const history: HaiUIMessage[] = conversation.messages.map(storedToUIMessage);
  const last = history.at(-1);
  const saveMessage = (message: HaiUIMessage) =>
    updateMessage(ctx.workspaceId, ctx.user.id, conversationId, message.id, {
      content: messageSummary(message),
      parts: [...message.parts],
    });

  switch (input.kind) {
    case "message": {
      if (last?.role === "assistant") {
        const settled = await settleOpenApprovals(scope, last, SKIPPED_REASON);
        if (settled) {
          await saveMessage(settled);
          history[history.length - 1] = settled;
        }
      }
      const parts = [{ type: "text" as const, text: input.text }];
      const id = await appendMessage(ctx.workspaceId, ctx.user.id, conversationId, {
        role: "user",
        content: input.text,
        parts,
      });
      history.push({ id, role: "user", parts });
      break;
    }

    case "approvals": {
      if (last?.role !== "assistant") {
        throw new AssistantTurnError(
          409,
          "Nothing is waiting for your approval.",
          "nothing_pending",
        );
      }
      const calls = toolCallParts(last);
      const waiting = calls.filter((part) => part.state === "approval-requested");
      const decidedBefore = calls.some((part) => part.state === "approval-responded");
      if (waiting.length === 0 && !decidedBefore) {
        throw new AssistantTurnError(
          409,
          "Nothing is waiting for your approval.",
          "nothing_pending",
        );
      }
      const decisions = new Map(input.decisions.map((d) => [d.approvalId, d.approved]));
      const outcomes = new Map<string, { approved: boolean; reason?: string }>();
      for (const part of waiting) {
        const approvalId = part.approval?.id ?? "";
        const asked = decisions.get(approvalId);
        if (asked === undefined) {
          throw new AssistantTurnError(
            400,
            "Approve or decline every change that is waiting.",
            "decision_missing",
          );
        }
        // A change whose tool is no longer offered (changes were turned off) cannot run.
        const available = Object.hasOwn(tools, part.toolName);
        let approved = asked && available;
        const reason = asked && !available ? WRITES_OFF_REASON : undefined;
        const decided = await decideToolAction(scope, part.toolCallId, approved);
        if (!decided) {
          // Already decided by an earlier request (a double tap or a retry): keep that decision.
          const existing = await getToolAction(scope, part.toolCallId);
          if (!existing) {
            throw new AssistantTurnError(
              409,
              "This change is no longer waiting for approval.",
              "not_pending",
            );
          }
          approved = existing.status !== "denied";
        }
        outcomes.set(part.toolCallId, { approved, ...(reason && !approved ? { reason } : {}) });
      }
      const decidedMessage = mapToolParts(last, (part) => {
        const outcome = outcomes.get(part.toolCallId as string);
        if (!outcome) return part;
        const approval = part.approval as { id: string };
        return {
          ...part,
          state: "approval-responded",
          approval: {
            id: approval.id,
            approved: outcome.approved,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
          },
        };
      });
      if (outcomes.size > 0) await saveMessage(decidedMessage);
      history[history.length - 1] = decidedMessage;
      break;
    }

    case "regenerate": {
      if (!last) {
        throw new AssistantTurnError(
          409,
          "There is nothing to answer again.",
          "nothing_to_regenerate",
        );
      }
      if (last.role === "assistant") {
        if (input.messageId && input.messageId !== last.id) {
          throw new AssistantTurnError(
            409,
            "Only the latest reply can be answered again.",
            "not_latest",
          );
        }
        const ids = toolCallParts(last).map((part) => part.toolCallId);
        const records = await listToolActions(scope, ids);
        const ran = [...records.values()].some((record) =>
          ["running", "succeeded", "failed"].includes(record.status),
        );
        if (ran || messageMadeChanges(last)) {
          throw new AssistantTurnError(
            409,
            "This reply made changes, so it can't be answered again. Ask hAI a follow-up instead.",
            "reply_made_changes",
          );
        }
        await declinePendingToolActions(scope, ids);
        await deleteMessages(ctx.workspaceId, ctx.user.id, conversationId, [last.id]);
        history.pop();
      }
      if (history.at(-1)?.role !== "user") {
        throw new AssistantTurnError(
          409,
          "There is nothing to answer again.",
          "nothing_to_regenerate",
        );
      }
      break;
    }
  }

  const persist = async ({ responseMessage, isContinuation }: AssistantTurnEnd) => {
    // The SDK answers a declined change inside the model history and leaves the part as
    // `approval-responded`. The decision is final, so store it as not done: later turns
    // then tell the model it was declined instead of dropping the call.
    const message = mapToolParts(responseMessage as HaiUIMessage, (part) =>
      part.state === "approval-responded" &&
      (part.approval as { approved?: unknown } | undefined)?.approved === false
        ? { ...part, state: "output-denied" }
        : part,
    );
    if (!message.parts.some((part) => part.type !== "step-start")) return;
    const content = messageSummary(message);
    if (isContinuation) {
      await saveMessage(message);
    } else {
      await appendMessage(ctx.workspaceId, ctx.user.id, conversationId, {
        id: message.id,
        role: "assistant",
        content,
        parts: [...message.parts],
      });
    }
  };

  const conversationIdText = conversationId as string;

  if (mock) {
    // The no-key mock answers from real workspace data and never proposes changes.
    const text = lastUserText(history);
    const safeAction = text ? buildMockHaiSafeAction(ctx, installedModules, text) : null;
    const reply = safeAction?.text ?? (await buildMockAssistantReply(ctx, installedModules));
    return streamMockAssistantTurn({
      messages: history as UIMessage[],
      text: reply,
      tool: safeAction?.tool,
      conversationId: conversationIdText,
      onEnd: persist,
    });
  }

  try {
    const model = getAIModel();
    const system = buildAssistantSystemPrompt({
      surface: opts.surface,
      role: ctx.role,
      installedModules,
      writeEnabled: conversation.writeEnabled,
      approvalsSupported: opts.approvalsSupported,
      workspace,
      now: new Date(),
      pageContext: input.kind === "message" ? input.pageContext : undefined,
    });
    const modelMessages = await convertToModelMessages(
      prepareModelHistory(selectModelHistory(history), new Set(Object.keys(tools))),
      { tools, ignoreIncompleteToolCalls: true },
    );
    const currency = workspace?.defaultCurrency ?? "AUD";
    const toolApproval = async (
      toolCall: { toolCallId: string; toolName: string; input: unknown },
      writer: UIMessageStreamWriter,
    ): Promise<AssistantToolApproval> => {
      const policy = assistantApprovalFor(toolCall.toolName, {
        approvalsSupported: opts.approvalsSupported,
      });
      if (policy.type === "not-applicable") return "not-applicable";
      if (policy.type === "denied") return { type: "denied", reason: policy.reason };
      const existing = await getToolAction(scope, toolCall.toolCallId);
      if (existing) {
        // The approval is checked again when the reply continues: it must still be the
        // same change, and the user's recorded decision is what counts.
        if (existing.toolName !== toolCall.toolName || !sameInput(existing.input, toolCall.input)) {
          return { type: "denied", reason: MISMATCH_REASON };
        }
        if (existing.status === "denied") return { type: "denied", reason: DECLINED_REASON };
        return "user-approval";
      }
      const preview = await buildActionPreview(ctx, toolCall.toolName, toolCall.input, {
        currency,
      });
      await recordProposedToolAction(scope, {
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        input: toolCall.input,
        preview,
      });
      writer.write({ type: "data-actionPreview", id: toolCall.toolCallId, data: preview });
      return "user-approval";
    };
    return streamAssistantTurn({
      model,
      system,
      messages: history as UIMessage[],
      modelMessages,
      tools: withActionLedger(tools, scope),
      toolApproval,
      conversationId: conversationIdText,
      usage: { workspaceId: ctx.workspaceId, surface: opts.surface },
      abortSignal: opts.abortSignal,
      onEnd: persist,
    });
  } catch (err) {
    // Failure before streaming starts - most commonly `getAIModel()` throwing because the
    // provider API key is unset. Surface the real cause as a stream error part so the chat
    // shows it (a plain JSON 500 would surface as an opaque transport error).
    console.error("[assistant] failed to start stream:", err);
    return streamAssistantError(err, conversationIdText);
  }
}
