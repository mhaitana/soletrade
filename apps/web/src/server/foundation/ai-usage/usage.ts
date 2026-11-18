import "server-only";
import type { AiCallUsage } from "@/server/infrastructure/ai/usage";
import { getDataClient } from "@/server/infrastructure/db/client";
import { rpc, unwrap } from "@/server/infrastructure/db/helpers";
import type { AiConversationId, UserId, WorkspaceId } from "@/types/ids";

/**
 * The hAI usage ledger: what each model call used, per workspace (`ai_usage_events`), and
 * the running totals per calendar month and feature (`ai_usage_monthly`). Tokens and the
 * model only; there is no price table, so nothing here is money, and nothing limits on it
 * yet.
 *
 * Every caller passes the workspace resolved from its authenticated request. Writes go
 * through one RPC (`record_ai_usage`) so the event and its month's totals commit together.
 */

/** What a model call was for. A new feature is a new name here; the column is text. */
export type AiUsageFeature = "chat" | "title" | "receipt";

export interface AiUsageEvent extends AiCallUsage {
  workspaceId: WorkspaceId;
  feature: AiUsageFeature;
  /** The person the call was made for, when there is one. */
  userId?: UserId | null;
  conversationId?: AiConversationId | null;
  /** Where the request came from, when the caller knows. */
  surface?: "web" | "mobile" | null;
}

/**
 * Record one model call. Never throws and never rejects: the work the usage belongs to
 * (a reply, a receipt) has already happened, so a ledger failure is logged and left
 * there. Callers on a reply's path should also not wait for it.
 */
export async function recordAiUsage(event: AiUsageEvent): Promise<void> {
  try {
    const { error } = await rpc(getDataClient(), "record_ai_usage", {
      p_workspace_id: event.workspaceId,
      p_feature: event.feature,
      p_provider: event.provider,
      p_model: event.model,
      p_input_tokens: event.inputTokens,
      p_output_tokens: event.outputTokens,
      p_cache_read_tokens: event.cacheReadTokens,
      p_cache_write_tokens: event.cacheWriteTokens,
      p_step_count: event.steps,
      p_user_id: event.userId ?? null,
      p_conversation_id: event.conversationId ?? null,
      p_surface: event.surface ?? null,
    });
    if (error) throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  } catch (err) {
    // Identifiers and counts only, never message content.
    console.error(
      "[ai-usage] could not record usage:",
      JSON.stringify({ workspaceId: event.workspaceId, feature: event.feature }),
      err,
    );
  }
}

/** One workspace's totals for one feature in one calendar month (UTC). */
export interface AiUsageMonthRow {
  /** The month as `YYYY-MM`. */
  month: string;
  feature: string;
  calls: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * A workspace's monthly totals from `fromMonth` (`YYYY-MM`, inclusive) onward, oldest
 * month first. A few rows per month, so there is nothing to page.
 */
export async function listMonthlyAiUsage(
  workspaceId: WorkspaceId,
  fromMonth: string,
): Promise<AiUsageMonthRow[]> {
  const rows = await unwrap(
    getDataClient()
      .from("ai_usage_monthly")
      .select(
        "month, feature, call_count, step_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens",
      )
      .eq("workspace_id", workspaceId)
      .gte("month", `${fromMonth}-01`)
      .order("month", { ascending: true })
      .order("feature", { ascending: true }),
  );
  return rows.map((row) => ({
    month: row.month.slice(0, 7),
    feature: row.feature,
    calls: Number(row.call_count),
    steps: Number(row.step_count),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheWriteTokens: Number(row.cache_write_tokens),
  }));
}
