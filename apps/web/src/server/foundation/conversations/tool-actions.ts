import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrap, unwrapMaybe } from "@/server/infrastructure/db/helpers";
import type { Database, Json } from "@/server/infrastructure/db/types";
import type { AiConversationId, UserId, WorkspaceId } from "@/types/ids";

/**
 * The ledger of changes hAI proposes (`ai_tool_actions`). A row is written when the model
 * asks to make a change, before anyone approves it, and then moves through
 *
 *   pending -> approved | denied        (the user decides)
 *   approved -> running -> succeeded | failed   (the change runs once)
 *
 * Every step is one conditional `UPDATE ... WHERE status = <expected>`, which Postgres
 * applies atomically: two clicks on Approve, a retried request or two server instances
 * cannot both win, so a change cannot run twice. The tool name and input stored here are
 * the server's copy of the model's call; nothing in a decision comes from the browser
 * except "yes" or "no".
 *
 * Every function is scoped to the conversation's owner in its workspace.
 */

export type ToolActionStatus = Database["public"]["Enums"]["ai_tool_action_status"];

export interface ToolActionScope {
  workspaceId: WorkspaceId;
  userId: UserId;
  conversationId: AiConversationId;
}

export interface ToolActionRecord {
  toolCallId: string;
  toolName: string;
  input: unknown;
  status: ToolActionStatus;
  result: unknown;
  error: string | null;
}

const COLUMNS = "tool_call_id, tool_name, input, status, result, error";

type Row = {
  tool_call_id: string;
  tool_name: string;
  input: Json;
  status: ToolActionStatus;
  result: Json | null;
  error: string | null;
};

function toRecord(row: Row): ToolActionRecord {
  return {
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    input: row.input,
    status: row.status,
    result: row.result,
    error: row.error,
  };
}

/** The row filter every ledger query applies: this user's conversation in this workspace. */
function owner(scope: ToolActionScope): Record<string, string> {
  return {
    workspace_id: scope.workspaceId,
    user_id: scope.userId,
    conversation_id: scope.conversationId,
  };
}

export async function getToolAction(
  scope: ToolActionScope,
  toolCallId: string,
): Promise<ToolActionRecord | null> {
  const row = await unwrapMaybe(
    getDataClient()
      .from("ai_tool_actions")
      .select(COLUMNS)
      .match(owner(scope))
      .eq("tool_call_id", toolCallId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toRecord(row as Row) : null;
}

/**
 * Record a proposed change as pending. Returns false when the call was already recorded
 * (the approval check runs again when an approved change resumes), so the caller writes
 * its preview once.
 */
export async function recordProposedToolAction(
  scope: ToolActionScope,
  input: { toolCallId: string; toolName: string; input: unknown; preview: unknown },
): Promise<boolean> {
  const rows = await unwrap(
    getDataClient()
      .from("ai_tool_actions")
      .upsert(
        {
          workspace_id: scope.workspaceId,
          user_id: scope.userId,
          conversation_id: scope.conversationId,
          tool_call_id: input.toolCallId,
          tool_name: input.toolName,
          input: (input.input ?? {}) as Json,
          preview: (input.preview ?? null) as Json,
        },
        { onConflict: "conversation_id,tool_call_id", ignoreDuplicates: true },
      )
      .select("tool_call_id"),
  );
  return rows.length > 0;
}

/**
 * Record the user's decision on a pending change. Returns the updated row, or null when
 * the change is not pending (already decided, never proposed, or someone else's).
 */
export async function decideToolAction(
  scope: ToolActionScope,
  toolCallId: string,
  approved: boolean,
): Promise<ToolActionRecord | null> {
  const rows = await unwrap(
    getDataClient()
      .from("ai_tool_actions")
      .update({
        status: approved ? "approved" : "denied",
        decided_at: new Date().toISOString(),
      })
      .match(owner(scope))
      .eq("tool_call_id", toolCallId)
      .eq("status", "pending")
      .select(COLUMNS),
  );
  return rows[0] ? toRecord(rows[0] as Row) : null;
}

/** The ledger rows for these calls, keyed by tool call id. */
export async function listToolActions(
  scope: ToolActionScope,
  toolCallIds: readonly string[],
): Promise<Map<string, ToolActionRecord>> {
  if (toolCallIds.length === 0) return new Map();
  const rows = await unwrap(
    getDataClient()
      .from("ai_tool_actions")
      .select(COLUMNS)
      .match(owner(scope))
      .in("tool_call_id", [...toolCallIds]),
  );
  return new Map(rows.map((row) => [row.tool_call_id, toRecord(row as Row)]));
}

/**
 * Decline every listed change that has not started: still waiting for a decision, or
 * approved but never run (the conversation moved on, or the reply is being regenerated).
 * A change that is running or finished is left as it is.
 */
export async function declinePendingToolActions(
  scope: ToolActionScope,
  toolCallIds: readonly string[],
): Promise<void> {
  if (toolCallIds.length === 0) return;
  await unwrap(
    getDataClient()
      .from("ai_tool_actions")
      .update({ status: "denied", decided_at: new Date().toISOString() })
      .match(owner(scope))
      .in("tool_call_id", [...toolCallIds])
      .in("status", ["pending", "approved"])
      .select("tool_call_id"),
  );
}

/**
 * Take an approved change for running. True for exactly one caller; false when the change
 * was not approved, is already running, or has finished.
 */
export async function claimToolAction(
  scope: ToolActionScope,
  toolCallId: string,
): Promise<boolean> {
  const rows = await unwrap(
    getDataClient()
      .from("ai_tool_actions")
      .update({ status: "running" })
      .match(owner(scope))
      .eq("tool_call_id", toolCallId)
      .eq("status", "approved")
      .select("tool_call_id"),
  );
  return rows.length > 0;
}

/** Store how a running change ended. */
export async function finishToolAction(
  scope: ToolActionScope,
  toolCallId: string,
  outcome: { ok: true; result: unknown } | { ok: false; error: string; result?: unknown },
): Promise<void> {
  await unwrap(
    getDataClient()
      .from("ai_tool_actions")
      .update({
        status: outcome.ok ? "succeeded" : "failed",
        result: (outcome.result ?? null) as Json,
        error: outcome.ok ? null : outcome.error.slice(0, 2000),
        completed_at: new Date().toISOString(),
      })
      .match(owner(scope))
      .eq("tool_call_id", toolCallId)
      .eq("status", "running")
      .select("tool_call_id"),
  );
}
