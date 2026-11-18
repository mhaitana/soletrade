// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The usage ledger service against a stand-in data client: what it sends to the
 * `record_ai_usage` function, that a failed write never reaches the caller, and how the
 * monthly totals are read. The function itself is tested on PostgreSQL in
 * usage.migration.test.ts.
 */

const client = vi.hoisted(() => ({
  rpc: vi.fn(),
  monthlyRows: [] as Record<string, unknown>[],
  monthlyError: null as { code: string; message: string } | null,
  calls: [] as unknown[][],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => {
    // A query builder that records each call and resolves like PostgREST does.
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq", "gte", "order"]) {
      builder[method] = (...args: unknown[]) => {
        client.calls.push([method, ...args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown) =>
      resolve({
        data: client.monthlyError ? null : client.monthlyRows,
        error: client.monthlyError,
      });
    return { ...builder, rpc: client.rpc };
  },
}));

import { listMonthlyAiUsage, recordAiUsage } from "@/server/foundation/ai-usage/usage";

const workspaceId = "00000000-0000-4000-8000-00000000a001" as never;
const event = {
  workspaceId,
  userId: "00000000-0000-4000-8000-00000000a002" as never,
  conversationId: "00000000-0000-4000-8000-00000000a003" as never,
  feature: "chat" as const,
  surface: "web" as const,
  provider: "anthropic",
  model: "test-model",
  inputTokens: 4_400,
  outputTokens: 50,
  cacheReadTokens: 2_000,
  cacheWriteTokens: 2_000,
  steps: 2,
};

beforeEach(() => {
  client.rpc.mockReset().mockResolvedValue({ data: "event-id", error: null });
  client.monthlyRows = [];
  client.monthlyError = null;
  client.calls = [];
});
afterEach(() => vi.restoreAllMocks());

describe("recordAiUsage", () => {
  it("records the call through the one function, with every count named", async () => {
    await recordAiUsage(event);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("record_ai_usage", {
      p_workspace_id: workspaceId,
      p_feature: "chat",
      p_provider: "anthropic",
      p_model: "test-model",
      p_input_tokens: 4_400,
      p_output_tokens: 50,
      p_cache_read_tokens: 2_000,
      p_cache_write_tokens: 2_000,
      p_step_count: 2,
      p_user_id: event.userId,
      p_conversation_id: event.conversationId,
      p_surface: "web",
    });
  });

  it("sends nulls for a call with no person, conversation or surface", async () => {
    await recordAiUsage({
      ...event,
      feature: "receipt",
      userId: undefined,
      conversationId: undefined,
      surface: undefined,
    });
    expect(client.rpc.mock.calls[0]![1]).toMatchObject({
      p_feature: "receipt",
      p_user_id: null,
      p_conversation_id: null,
      p_surface: null,
    });
  });

  it("never rejects: a failed write is logged with identifiers only", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    client.rpc.mockResolvedValue({ data: null, error: { code: "23503", message: "no workspace" } });
    await expect(recordAiUsage(event)).resolves.toBeUndefined();

    client.rpc.mockRejectedValue(new Error("network down"));
    await expect(recordAiUsage(event)).resolves.toBeUndefined();

    expect(errors).toHaveBeenCalledTimes(2);
    const [label, identifiers] = errors.mock.calls[0]!;
    expect(label).toBe("[ai-usage] could not record usage:");
    expect(JSON.parse(String(identifiers))).toEqual({ workspaceId, feature: "chat" });
  });
});

describe("listMonthlyAiUsage", () => {
  it("reads one workspace's months from the given month on, oldest first", async () => {
    client.monthlyRows = [
      {
        month: "2026-10-01",
        feature: "chat",
        call_count: 3,
        step_count: 7,
        input_tokens: 9_000,
        output_tokens: 400,
        cache_read_tokens: 5_000,
        cache_write_tokens: 1_000,
      },
    ];
    expect(await listMonthlyAiUsage(workspaceId, "2026-09")).toEqual([
      {
        month: "2026-10",
        feature: "chat",
        calls: 3,
        steps: 7,
        inputTokens: 9_000,
        outputTokens: 400,
        cacheReadTokens: 5_000,
        cacheWriteTokens: 1_000,
      },
    ]);
    expect(client.calls).toContainEqual(["from", "ai_usage_monthly"]);
    // Scoped to the workspace the caller resolved, and bounded by month.
    expect(client.calls).toContainEqual(["eq", "workspace_id", workspaceId]);
    expect(client.calls).toContainEqual(["gte", "month", "2026-09-01"]);
  });

  it("throws when the read fails, unlike recording", async () => {
    client.monthlyError = { code: "42501", message: "permission denied" };
    await expect(listMonthlyAiUsage(workspaceId, "2026-09")).rejects.toThrow(/permission denied/);
  });
});
