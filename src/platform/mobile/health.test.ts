// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  counts: [] as number[],
  filters: [] as [string, string, unknown][],
}));
vi.mock("@/server/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/platform/mobile/http", () => ({
  MobileApiError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/db/client", () => ({
  getDataClient: () => ({
    from: (table: string) => ({
      select: () => {
        const response = { count: mocks.counts.shift() ?? 0, error: null };
        const query = {
          in: async () => response,
          eq: (column: string, value: unknown) => {
            mocks.filters.push([table, column, value]);
            return query;
          },
          not: (column: string, operator: string, value: unknown) => {
            mocks.filters.push([table, `${column}:${operator}`, value]);
            return query;
          },
          lt: () => query,
          then: (resolve: (value: typeof response) => void) => resolve(response),
        };
        return query;
      },
    }),
  }),
}));
import { recordMobileHealth, summarizeMobileJobHealth } from "./health";
import type { UserId } from "@/shared/types/ids";
const user = "private-user" as UserId;
const event = {
  eventId: "11111111-1111-4111-8111-111111111111",
  kind: "recording_interruption",
  reason: "interrupted",
  platform: "ios",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.counts = [];
  mocks.filters = [];
  mocks.rateLimit.mockResolvedValue(true);
});
it("accepts and logs only the strict operational event fields", async () => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  expect(await recordMobileHealth(user, { events: [event] })).toEqual({ accepted: true });
  expect(log).toHaveBeenCalledWith("Mobile device health", event);
  expect(JSON.stringify(log.mock.calls)).not.toContain(user);
  log.mockRestore();
});
it.each(["latitude", "route", "message", "workspaceId", "fileId", "draftId"])(
  "rejects unexpected private field %s before logging",
  async (key) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      recordMobileHealth(user, { events: [{ ...event, [key]: "private" }] }),
    ).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  },
);
it("rate limits reports without logging them", async () => {
  mocks.rateLimit.mockResolvedValue(false);
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await expect(recordMobileHealth(user, { events: [event] })).rejects.toMatchObject({
    status: 429,
  });
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});
it("reports only aggregate counts for durable jobs needing attention", async () => {
  mocks.counts = [1, 2, 3, 4, 5];
  const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const health = await summarizeMobileJobHealth();
  expect(health).toEqual({
    pushJobsNeedingAttention: 1,
    pushDevicesNeedingAttention: 2,
    failedBillingEvents: 3,
    uncertainOperations: 4,
    overdueAccountPurges: 5,
  });
  expect(log).toHaveBeenCalledWith("Mobile job health", health);
  expect(mocks.filters).toContainEqual(["mobile_api_operations", "status", "processing"]);
  expect(mocks.filters).toContainEqual([
    "mobile_api_operations",
    "operation:like",
    "%/assistant/%",
  ]);
  log.mockRestore();
});
