// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiUsageMonthRow } from "@/server/foundation/ai-usage/usage";

const listMonthlyAiUsage = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/server/foundation/ai-usage/usage", () => ({ listMonthlyAiUsage }));

import { getAssistantUsageOverview } from "@/server/application/assistant/usage";

const workspaceId = "00000000-0000-4000-8000-00000000a001" as never;

const row = (month: string, feature: string, calls: number, input: number): AiUsageMonthRow => ({
  month,
  feature,
  calls,
  steps: calls * 2,
  inputTokens: input,
  outputTokens: Math.round(input / 10),
  cacheReadTokens: Math.round(input / 2),
  cacheWriteTokens: Math.round(input / 4),
});

beforeEach(() => listMonthlyAiUsage.mockReset().mockResolvedValue([]));

describe("getAssistantUsageOverview", () => {
  it("reads the current month and the two before it for the given workspace", async () => {
    await getAssistantUsageOverview(workspaceId, new Date("2026-11-18T03:00:00Z"));
    expect(listMonthlyAiUsage).toHaveBeenCalledWith(workspaceId, "2026-09");
  });

  it("goes back across a year boundary", async () => {
    const overview = await getAssistantUsageOverview(workspaceId, new Date("2027-01-05T00:00:00Z"));
    expect(listMonthlyAiUsage).toHaveBeenCalledWith(workspaceId, "2026-11");
    expect([overview.current.month, ...overview.previous.map((m) => m.month)]).toEqual([
      "2027-01",
      "2026-12",
      "2026-11",
    ]);
  });

  it("uses the UTC month, as the ledger does", async () => {
    // Already 1 December in Sydney, still November in UTC.
    const overview = await getAssistantUsageOverview(workspaceId, new Date("2026-11-30T20:00:00Z"));
    expect(overview.current.month).toBe("2026-11");
  });

  it("groups each month by feature, chat first, with the month's totals", async () => {
    listMonthlyAiUsage.mockResolvedValue([
      row("2026-09", "chat", 4, 8_000),
      row("2026-11", "title", 3, 300),
      row("2026-11", "receipt", 2, 4_000),
      row("2026-11", "chat", 10, 60_000),
    ]);
    const overview = await getAssistantUsageOverview(workspaceId, new Date("2026-11-18T03:00:00Z"));

    expect(overview.current.month).toBe("2026-11");
    expect(overview.current.features.map((f) => f.feature)).toEqual(["chat", "receipt", "title"]);
    // Requests to a model across the features: 10 chat, 2 receipt, 3 title.
    expect(overview.current.totals).toEqual({
      calls: 15,
      inputTokens: 64_300,
      outputTokens: 6_430,
      cacheReadTokens: 32_150,
      cacheWriteTokens: 16_075,
    });
    // Most recent first; a month with nothing in it is still listed, as zeros.
    expect(overview.previous.map((m) => [m.month, m.totals.calls, m.totals.inputTokens])).toEqual([
      ["2026-10", 0, 0],
      ["2026-09", 4, 8_000],
    ]);
    expect(overview.previous[0]!.features).toEqual([]);
  });

  it("counts a month that only scanned receipts", async () => {
    listMonthlyAiUsage.mockResolvedValue([row("2026-11", "receipt", 2, 4_000)]);
    const overview = await getAssistantUsageOverview(workspaceId, new Date("2026-11-18T03:00:00Z"));
    expect(overview.current.totals.calls).toBe(2);
    expect(overview.current.features.map((f) => f.feature)).toEqual(["receipt"]);
  });
});
