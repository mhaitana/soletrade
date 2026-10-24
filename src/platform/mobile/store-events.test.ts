// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  verifyGoogle: vi.fn(),
  verifyApple: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/platform/mobile/billing", () => ({
  verifyGooglePurchase: mocks.verifyGoogle,
  verifyApplePurchase: mocks.verifyApple,
  applyVerifiedPurchase: mocks.apply,
  appleConfiguration: vi.fn(),
}));
vi.mock("@/platform/mobile/http", () => ({
  MobileApiError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

// A small stateful PostgREST adapter: tests inspect both selection order and
// persisted attempt counts, rather than merely asserting fluent calls.
vi.mock("@/server/db/client", () => ({
  getDataClient: () => ({
    from: (table: string) => {
      let action = "select",
        values: Row = {},
        maximum = Infinity;
      const filters: Array<(row: Row) => boolean> = [];
      const ordering: Array<{ key: string; nullsFirst: boolean }> = [];
      const execute = () => {
        const all = mocks.tables[table] ?? (mocks.tables[table] = []);
        if (action === "upsert") {
          if (
            !all.some(
              (row) =>
                row.event_id === values.event_id &&
                row.provider === values.provider &&
                row.environment === values.environment,
            )
          )
            all.push({ id: `new-${all.length}`, attempts: 0, ...values });
          return { data: null, error: null };
        }
        let rows = all.filter((row) => filters.every((filter) => filter(row)));
        rows = rows
          .sort((a, b) => {
            for (const { key, nullsFirst } of ordering) {
              if (a[key] == null && b[key] != null) return nullsFirst ? -1 : 1;
              if (b[key] == null && a[key] != null) return nullsFirst ? 1 : -1;
              const compared = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
              if (compared) return compared;
            }
            return 0;
          })
          .slice(0, maximum);
        if (action === "update") for (const row of rows) Object.assign(row, values);
        return { data: rows.map((row) => ({ ...row })), error: null };
      };
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return query;
        },
        lt: (key: string, value: number) => {
          filters.push((row) => Number(row[key]) < value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]));
          return query;
        },
        order: (key: string, options?: { nullsFirst?: boolean }) => {
          ordering.push({ key, nullsFirst: options?.nullsFirst ?? false });
          return query;
        },
        limit: (value: number) => {
          maximum = value;
          return query;
        },
        update: (value: Row) => {
          action = "update";
          values = value;
          return query;
        },
        upsert: (value: Row) => {
          action = "upsert";
          values = value;
          return query;
        },
        single: async () => {
          const result = execute();
          return { ...result, data: result.data?.[0] ?? null };
        },
        maybeSingle: async () => {
          const result = execute();
          return { ...result, data: result.data?.[0] ?? null };
        },
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolve),
      };
      return query;
    },
  }),
}));

import { reconcileStoreContracts } from "./store-events";

const event = (index: number, attempts = 0): Row => ({
  id: `event-${index}`,
  provider: "google",
  event_id: `event-${index}`,
  environment: "Production",
  external_id: `token-${index}`,
  status: "pending",
  attempts,
  updated_at: `2020-01-01T00:${String(index).padStart(3, "0")}:00Z`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tables = { billing_contracts: [], billing_events: [], store_workspace_bindings: [] };
  mocks.verifyGoogle.mockImplementation(async (token: string) => ({
    provider: "google",
    externalId: token,
    environment: "Production",
    productId: "books",
    verificationRevision: 1,
  }));
  mocks.apply.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("store reconciliation fairness and bounded attempts", () => {
  it("rotates failed contracts so the 101st contract is refreshed on the next pass", async () => {
    mocks.tables.billing_contracts = Array.from({ length: 101 }, (_, index) => ({
      id: `contract-${String(index).padStart(3, "0")}`,
      provider: "google",
      current: true,
      external_id: `token-${index}`,
      owner_user_id: "user",
      workspace_id: "workspace",
      last_verification_attempt_at: null,
    }));
    mocks.verifyGoogle.mockRejectedValue(new Error("Provider unavailable"));
    await reconcileStoreContracts();
    expect(mocks.verifyGoogle).not.toHaveBeenCalledWith("token-100");
    await reconcileStoreContracts();
    expect(mocks.verifyGoogle).toHaveBeenCalledWith("token-100");
    expect(
      mocks.tables.billing_contracts.every((row) => row.last_verification_attempt_at !== null),
    ).toBe(true);
  });

  it("rotates unmatched events and increments attempts only once per pass", async () => {
    mocks.tables.billing_events = Array.from({ length: 101 }, (_, index) => event(index));
    await reconcileStoreContracts();
    expect(mocks.verifyGoogle).not.toHaveBeenCalledWith("token-100");
    expect(mocks.tables.billing_events[0]?.attempts).toBe(1);
    await reconcileStoreContracts();
    expect(mocks.verifyGoogle).toHaveBeenCalledWith("token-100");
    expect(mocks.tables.billing_events[100]?.attempts).toBe(1);
  });

  it("bounds provider failures even when verification fails before event processing", async () => {
    mocks.tables.billing_events = [event(0, 19)];
    mocks.verifyGoogle.mockRejectedValue(new Error("Token unavailable"));
    await reconcileStoreContracts();
    expect(mocks.tables.billing_events[0]).toMatchObject({
      attempts: 20,
      status: "failed",
      error_code: "VERIFY_FAILED",
    });
    await reconcileStoreContracts();
    expect(mocks.verifyGoogle).toHaveBeenCalledTimes(1);
  });

  it("retains an unmatched exhausted event for inspection without monopolizing retries", async () => {
    mocks.tables.billing_events = [event(0, 19)];
    await reconcileStoreContracts();
    expect(mocks.tables.billing_events[0]).toMatchObject({
      attempts: 20,
      status: "failed",
      error_code: "PURCHASE_NOT_BOUND",
    });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("completes a bound event with one durable attempt", async () => {
    mocks.tables.billing_events = [event(0)];
    mocks.tables.store_workspace_bindings = [
      { provider: "google", external_id: "token-0", user_id: "user", workspace_id: "workspace" },
    ];
    await reconcileStoreContracts();
    expect(mocks.tables.billing_events[0]).toMatchObject({
      attempts: 1,
      status: "complete",
      error_code: null,
    });
    expect(mocks.apply).toHaveBeenCalledOnce();
  });
});
