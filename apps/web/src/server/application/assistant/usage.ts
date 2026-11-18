import "server-only";
import { listMonthlyAiUsage } from "@/server/foundation/ai-usage/usage";
import type { WorkspaceId } from "@/types/ids";

/**
 * What a workspace's hAI has used, for the settings page: the current calendar month by
 * feature and the two months before it. Read from the monthly totals the ledger keeps, so
 * it is a handful of rows however busy the workspace is. Months are UTC, as the ledger
 * stores them. Token counts only: there is no price table to turn them into money.
 */

export interface AssistantUsageTotals {
  /**
   * Requests to a model. For chat that is not the same as turns: a reply that pauses for
   * an approval and then continues is two requests, so the page calls these "requests".
   */
  calls: number;
  /** Every input token, including the ones served from the provider's prompt cache. */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens served from the cache (a part of `inputTokens`). */
  cacheReadTokens: number;
  /** Input tokens written to the cache (a part of `inputTokens`). */
  cacheWriteTokens: number;
}

export interface AssistantUsageFeature extends AssistantUsageTotals {
  feature: string;
}

export interface AssistantUsageMonth {
  /** `YYYY-MM`. */
  month: string;
  totals: AssistantUsageTotals;
  /** One entry per feature that was used, chat first. */
  features: AssistantUsageFeature[];
}

export interface AssistantUsageOverview {
  current: AssistantUsageMonth;
  /** The two months before the current one, most recent first. */
  previous: AssistantUsageMonth[];
}

/** How many months before the current one the overview shows. */
const PREVIOUS_MONTHS = 2;

/** `YYYY-MM` for the UTC month `back` months before `now`. */
function utcMonth(now: Date, back: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const emptyTotals = (): AssistantUsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** Chat first, then the other features by name. */
function byFeature(a: AssistantUsageFeature, b: AssistantUsageFeature): number {
  if (a.feature === b.feature) return 0;
  if (a.feature === "chat") return -1;
  if (b.feature === "chat") return 1;
  return a.feature < b.feature ? -1 : 1;
}

export async function getAssistantUsageOverview(
  workspaceId: WorkspaceId,
  now: Date = new Date(),
): Promise<AssistantUsageOverview> {
  const months = Array.from({ length: PREVIOUS_MONTHS + 1 }, (_, back) => utcMonth(now, back));
  const rows = await listMonthlyAiUsage(workspaceId, months.at(-1)!);

  const summarise = (month: string): AssistantUsageMonth => {
    const features: AssistantUsageFeature[] = rows
      .filter((row) => row.month === month)
      .map((row) => ({
        feature: row.feature,
        calls: row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
      }))
      .sort(byFeature);
    const totals = emptyTotals();
    for (const feature of features) {
      totals.calls += feature.calls;
      totals.inputTokens += feature.inputTokens;
      totals.outputTokens += feature.outputTokens;
      totals.cacheReadTokens += feature.cacheReadTokens;
      totals.cacheWriteTokens += feature.cacheWriteTokens;
    }
    return { month, totals, features };
  };

  const [current, ...previous] = months.map(summarise);
  return { current: current!, previous };
}
