// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const b = vi.hoisted(() => ({
  tables: {} as Record<
    | "users"
    | "notifications"
    | "mobile_notification_outbox"
    | "mobile_devices"
    | "mobile_push_deliveries",
    Record<string, unknown>[]
  > &
    Record<string, Record<string, unknown>[]>,
  fetch: vi.fn(),
  role: vi.fn(),
  workspace: vi.fn(),
  modules: vi.fn(),
  prefs: vi.fn(),
}));
vi.mock("@/server/foundation/workspaces", () => ({
  getMembershipRole: b.role,
  getWorkspace: b.workspace,
}));
vi.mock("@/server/foundation/module-installations", () => ({
  getInstalledModules: b.modules,
  isModuleEnabled: async (_: string, key: string) => (await b.modules()).includes(key),
}));
vi.mock("@/server/application/mobile/account", () => ({ getMobilePreferences: b.prefs }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    from: (table: string) => {
      let mode = "read";
      let payload: Record<string, unknown> | Record<string, unknown>[] = {};
      let single = false;
      let cap = Infinity;
      let first = 0;
      let ignoreDuplicates = false;
      let conflictKeys: string[] = [];
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const sort: { key: string; ascending: boolean }[] = [];
      const q = {
        select: () => q,
        update: (value: Record<string, unknown>) => {
          mode = "update";
          payload = value;
          return q;
        },
        insert: (value: Record<string, unknown> | Record<string, unknown>[]) => {
          mode = "insert";
          payload = value;
          return q;
        },
        upsert: (
          value: Record<string, unknown> | Record<string, unknown>[],
          options?: { ignoreDuplicates?: boolean; onConflict?: string },
        ) => {
          mode = "upsert";
          payload = value;
          ignoreDuplicates = options?.ignoreDuplicates ?? false;
          conflictKeys = options?.onConflict?.split(",") ?? [];
          return q;
        },
        delete: () => {
          mode = "delete";
          return q;
        },
        eq: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return q;
        },
        neq: (key: string, value: unknown) => {
          filters.push((row) => row[key] !== value);
          return q;
        },
        is: (key: string, value: unknown) => {
          filters.push((row) => row[key] === value);
          return q;
        },
        in: (key: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[key]));
          return q;
        },
        not: (key: string, operator: string, value: unknown) => {
          filters.push((row) => (operator === "is" ? row[key] !== value : row[key] !== value));
          return q;
        },
        lt: (key: string, value: unknown) => {
          filters.push((row) => String(row[key]) < String(value));
          return q;
        },
        lte: (key: string, value: unknown) => {
          filters.push((row) => String(row[key]) <= String(value));
          return q;
        },
        gt: (key: string, value: unknown) => {
          filters.push((row) => String(row[key]) > String(value));
          return q;
        },
        gte: (key: string, value: unknown) => {
          filters.push((row) => String(row[key]) >= String(value));
          return q;
        },
        order: (key: string, opts?: { ascending?: boolean }) => {
          sort.push({ key, ascending: opts?.ascending ?? true });
          return q;
        },
        limit: (value: number) => {
          cap = value;
          return q;
        },
        range: (start: number, end: number) => {
          first = start;
          cap = end - start + 1;
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        single: () => {
          single = true;
          return q;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const rows = b.tables[table] ?? (b.tables[table] = []);
          let selected = rows.filter((row) => filters.every((filter) => filter(row)));
          if (mode === "insert" || mode === "upsert") {
            selected = [];
            for (const value of Array.isArray(payload) ? payload : [payload]) {
              const existing = conflictKeys.length
                ? rows.find((row) => conflictKeys.every((key) => row[key] === value[key]))
                : undefined;
              if (existing) {
                if (!ignoreDuplicates) Object.assign(existing, value);
                selected.push(existing);
                continue;
              }
              const now = new Date().toISOString();
              const row = {
                id: `delivery-${rows.length + 1}`,
                status: "pending",
                attempts: 0,
                receipt_attempts: 0,
                receipt_status: null,
                ticket_id: null,
                accepted_at: null,
                receipt_poll_after: null,
                next_attempt_at: now,
                error_code: null,
                created_at: now,
                updated_at: now,
                ...value,
              };
              rows.push(row);
              selected.push(row);
            }
          }
          if (mode === "update") selected.forEach((row) => Object.assign(row, payload));
          if (mode === "delete") b.tables[table] = rows.filter((row) => !selected.includes(row));
          if (sort.length)
            selected.sort((a, c) => {
              for (const s of sort) {
                const cmp = String(a[s.key]).localeCompare(String(c[s.key]));
                if (cmp) return s.ascending ? cmp : -cmp;
              }
              return 0;
            });
          selected = selected.slice(first, first + cap);
          return Promise.resolve({
            data: single ? (selected[0] ?? null) : selected,
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
  }),
}));

import { deliverMobilePush, inQuietHours } from "@/server/application/mobile/push";
const user = "11111111-1111-4111-8111-111111111111",
  workspace = "22222222-2222-4222-8222-222222222222",
  notification = "33333333-3333-4333-8333-333333333333",
  job = "44444444-4444-4444-8444-444444444444";
const baseTime = "2026-10-25T12:00:00.000Z";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const deliveries = () => b.tables.mobile_push_deliveries ?? [];
const sends = () =>
  b.fetch.mock.calls
    .filter(([url]) => String(url).endsWith("/send"))
    .map(
      ([, options]) =>
        JSON.parse(options.body) as {
          to: string;
          title: string;
          body: string;
          data: { path: string };
        }[],
    );
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(baseTime));
  vi.resetAllMocks();
  vi.stubGlobal("fetch", b.fetch);
  b.role.mockResolvedValue("owner");
  b.workspace.mockResolvedValue({ id: workspace, deletedAt: null });
  b.modules.mockResolvedValue(["invoices", "quotes", "books", "drive"]);
  b.prefs.mockResolvedValue({
    quietHoursStart: 22,
    quietHoursEnd: 7,
    notificationCategories: ["payments", "quotes", "receipts", "reminders"],
  });
  b.tables = {
    users: [{ id: user, deleted_at: null }],
    notifications: [
      {
        id: notification,
        user_id: user,
        workspace_id: workspace,
        type: "invoice.paid",
        entity_type: "invoice",
        entity_id: "55555555-5555-4555-8555-555555555555",
        title: "Invoice INV-123 paid",
        body: "AUD 12345.67 from Private Customer",
        read_at: null,
      },
    ],
    mobile_notification_outbox: [
      {
        id: job,
        notification_id: notification,
        user_id: user,
        workspace_id: workspace,
        category: "payments",
        status: "pending",
        attempts: 0,
        next_attempt_at: baseTime,
        created_at: baseTime,
        updated_at: baseTime,
        error_code: null,
      },
    ],
    mobile_devices: [
      {
        id: "phone-a",
        user_id: user,
        token: "ExpoPushToken[a]",
        timezone: "UTC",
        enabled: true,
        updated_at: baseTime,
      },
      {
        id: "phone-b",
        user_id: user,
        token: "ExpoPushToken[b]",
        timezone: "UTC",
        enabled: true,
        updated_at: baseTime,
      },
    ],
    mobile_push_deliveries: [],
  };
  b.fetch.mockImplementation(async (url: string, options: RequestInit) =>
    String(url).endsWith("getReceipts")
      ? json({ data: {} })
      : json({
          data: JSON.parse(String(options.body)).map((message: { to: string }) => ({
            status: "ok",
            id: `ticket-${message.to.includes("[a]") ? "a" : "b"}`,
          })),
        }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("durable Expo push delivery", () => {
  it("retries only the rejected device after a partially accepted batch", async () => {
    b.fetch.mockResolvedValueOnce(
      json({
        data: [
          { status: "ok", id: "ticket-a" },
          { status: "error", details: { error: "MessageRateExceeded" } },
        ],
      }),
    );
    await deliverMobilePush();
    expect(deliveries().find((row) => row.device_id === "phone-a")).toMatchObject({
      status: "accepted",
      ticket_id: "ticket-a",
      attempts: 1,
    });
    expect(deliveries().find((row) => row.device_id === "phone-b")).toMatchObject({
      status: "pending",
      attempts: 1,
    });
    vi.setSystemTime(Date.now() + 120_000);
    await deliverMobilePush();
    expect(sends().map((messages) => messages.map((m) => m.to))).toEqual([
      ["ExpoPushToken[a]", "ExpoPushToken[b]"],
      ["ExpoPushToken[b]"],
    ]);
  });
  it("keeps a quiet device pending after another device accepted the notification", async () => {
    b.tables.mobile_devices[0]!.timezone = "Australia/Melbourne";
    await deliverMobilePush();
    expect(deliveries().find((row) => row.device_id === "phone-a")).toMatchObject({
      status: "deferred",
      next_attempt_at: "2026-10-25T20:00:00.000Z",
      attempts: 0,
    });
    expect(sends()[0]?.map((m) => m.to)).toEqual(["ExpoPushToken[b]"]);
    vi.setSystemTime(new Date("2026-10-25T20:00:00.000Z"));
    await deliverMobilePush();
    expect(sends()[1]?.map((m) => m.to)).toEqual(["ExpoPushToken[a]"]);
  });
  it("persists tickets then polls receipts after fifteen minutes and disables an unregistered token", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    await deliverMobilePush();
    expect(deliveries()[0]).toMatchObject({
      ticket_id: "ticket-a",
      receipt_status: "pending",
      receipt_poll_after: "2026-10-25T12:15:00.000Z",
    });
    vi.setSystemTime(Date.now() + 15 * 60_000);
    b.fetch.mockResolvedValueOnce(
      json({
        data: { "ticket-a": { status: "error", details: { error: "DeviceNotRegistered" } } },
      }),
    );
    await deliverMobilePush();
    expect(b.tables.mobile_devices[0]!.enabled).toBe(false);
    expect(deliveries()[0]).toMatchObject({
      status: "failed",
      receipt_status: "error",
      error_code: "DeviceNotRegistered",
    });
    expect(sends()).toHaveLength(1);
  });
  it("does not disable a newly registered token when an old receipt reports removal", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    await deliverMobilePush();
    vi.setSystemTime(Date.now() + 15 * 60_000);
    b.tables.mobile_devices[0]!.token = "ExpoPushToken[new]";
    b.tables.mobile_devices[0]!.updated_at = new Date().toISOString();
    b.fetch.mockResolvedValueOnce(
      json({
        data: { "ticket-a": { status: "error", details: { error: "DeviceNotRegistered" } } },
      }),
    );
    await deliverMobilePush();
    expect(b.tables.mobile_devices[0]!.enabled).toBe(true);
  });
  it("also cleans up DeviceNotRegistered ticket errors", async () => {
    b.fetch.mockResolvedValueOnce(
      json({
        data: [
          { status: "error", details: { error: "DeviceNotRegistered" } },
          { status: "ok", id: "ticket-b" },
        ],
      }),
    );
    await deliverMobilePush();
    expect(b.tables.mobile_devices[0]!.enabled).toBe(false);
    expect(b.tables.mobile_devices[1]!.enabled).toBe(true);
  });
  it("does not treat empty ticket responses as accepted or blindly resend them", async () => {
    b.fetch.mockResolvedValueOnce(json({ data: [] }));
    await deliverMobilePush();
    expect(deliveries()).toHaveLength(2);
    expect(deliveries().every((row) => row.status === "uncertain")).toBe(true);
    vi.setSystemTime(Date.now() + 60_000);
    await deliverMobilePush();
    expect(sends()).toHaveLength(1);
  });
  it("backs off after HTTP 503 and resumes only unaccepted deliveries", async () => {
    b.fetch.mockResolvedValueOnce(json({ errors: [{ code: "SERVER_ERROR" }] }, 503));
    await deliverMobilePush();
    expect(
      deliveries().every((row) => row.status === "pending" && Number(row.attempts) === 1),
    ).toBe(true);
    await deliverMobilePush();
    expect(sends()).toHaveLength(1);
    vi.setSystemTime(Date.now() + 120_000);
    await deliverMobilePush();
    expect(deliveries().every((row) => row.status === "accepted")).toBe(true);
  });
  it("records ambiguous transport failure without automatically repeating a possible accepted send", async () => {
    b.fetch.mockRejectedValueOnce(new TypeError("connection reset"));
    await deliverMobilePush();
    expect(deliveries().every((row) => row.status === "uncertain")).toBe(true);
    vi.setSystemTime(Date.now() + 3_600_000);
    await deliverMobilePush();
    expect(sends()).toHaveLength(1);
  });
  it("bounds receipt polling at the twenty-four-hour retention deadline", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    await deliverMobilePush();
    vi.setSystemTime(Date.now() + 24 * 3_600_000);
    await deliverMobilePush();
    expect(deliveries()[0]).toMatchObject({ status: "uncertain", receipt_status: "unknown" });
    expect(sends()).toHaveLength(1);
  });
  it("skips read notifications and revoked module permissions", async () => {
    b.tables.notifications[0]!.read_at = baseTime;
    await deliverMobilePush();
    expect(b.fetch).not.toHaveBeenCalled();
    b.tables.notifications[0]!.read_at = null;
    b.tables.mobile_notification_outbox[0]!.status = "pending";
    b.modules.mockResolvedValue([]);
    await deliverMobilePush();
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("keeps financial details out of lock-screen payloads and routes only known entity types", async () => {
    b.tables.notifications[0]!.entity_type = "credit";
    b.tables.notifications[0]!.type = "billing.credit";
    await deliverMobilePush();
    const payload = sends()[0]?.[0];
    expect(payload?.body).toBe("There is an update in your business workspace.");
    expect(JSON.stringify(payload)).not.toMatch(/12345|Private Customer|INV-123/);
    expect(payload?.data.path).toBe("/resource/notifications");
  });
  it("routes ownership and legal notifications to the legal/account screen", async () => {
    b.tables.notifications[0]!.type = "legal.updated";
    b.tables.notifications[0]!.entity_type = null;
    await deliverMobilePush();
    expect(sends()[0]?.[0]?.data.path).toBe("/legal");
  });
  it("calculates overnight quiet hours in the device timezone", () => {
    expect(inQuietHours(22, 7, "Australia/Melbourne", new Date(baseTime))).toBe(true);
    expect(inQuietHours(22, 7, "UTC", new Date(baseTime))).toBe(false);
    expect(inQuietHours(7, 7, "UTC", new Date(baseTime))).toBe(false);
  });
  it("polls receipts with backoff after 503 without sending accepted messages again", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    await deliverMobilePush();
    vi.setSystemTime(Date.now() + 15 * 60_000);
    b.fetch.mockResolvedValueOnce(json({ errors: [{ code: "SERVER_ERROR" }] }, 503));
    await deliverMobilePush();
    expect(deliveries()[0]).toMatchObject({
      status: "accepted",
      receipt_status: "pending",
      receipt_attempts: 1,
    });
    const before = b.fetch.mock.calls.length;
    await deliverMobilePush();
    expect(b.fetch.mock.calls).toHaveLength(before);
    vi.setSystemTime(Date.now() + 120_000);
    b.fetch.mockResolvedValueOnce(json({ data: { "ticket-a": { status: "ok" } } }));
    await deliverMobilePush();
    expect(deliveries()[0]).toMatchObject({
      status: "delivered",
      receipt_status: "ok",
      receipt_attempts: 2,
    });
    expect(sends()).toHaveLength(1);
  });
  it("keeps missing receipts pending instead of claiming device delivery", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    await deliverMobilePush();
    vi.setSystemTime(Date.now() + 15 * 60_000);
    await deliverMobilePush();
    expect(deliveries()[0]).toMatchObject({
      status: "accepted",
      receipt_status: "pending",
      error_code: "RECEIPT_NOT_READY",
    });
    expect(sends()).toHaveLength(1);
  });
  it("stops send retries after the bounded attempt limit", async () => {
    b.fetch.mockResolvedValueOnce(json({}, 503));
    await deliverMobilePush();
    deliveries().forEach((row) => {
      row.attempts = 7;
    });
    vi.setSystemTime(Date.now() + 120_000);
    b.fetch.mockResolvedValueOnce(json({}, 503));
    await deliverMobilePush();
    expect(deliveries().every((row) => row.status === "failed" && row.attempts === 8)).toBe(true);
    vi.setSystemTime(Date.now() + 3_600_000);
    await deliverMobilePush();
    expect(sends()).toHaveLength(2);
  });
  it("does not disable a refreshed registration with the same token from an old receipt", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    await deliverMobilePush();
    vi.setSystemTime(Date.now() + 15 * 60_000);
    b.tables.mobile_devices[0]!.updated_at = new Date().toISOString();
    b.fetch.mockResolvedValueOnce(
      json({
        data: { "ticket-a": { status: "error", details: { error: "DeviceNotRegistered" } } },
      }),
    );
    await deliverMobilePush();
    expect(b.tables.mobile_devices[0]!.enabled).toBe(true);
    expect(deliveries()[0]?.status).toBe("failed");
  });
  it("treats tickets without IDs as uncertain and never calls them successful", async () => {
    b.fetch.mockResolvedValueOnce(json({ data: [{ status: "ok" }, { status: "ok" }] }));
    const result = await deliverMobilePush();
    expect(result.accepted).toBe(0);
    expect(deliveries().every((row) => row.status === "uncertain")).toBe(true);
  });
  it("rechecks read state immediately before submitting to Expo", async () => {
    let calls = 0;
    b.role.mockImplementation(async () => {
      calls++;
      if (calls === 3) b.tables.notifications[0]!.read_at = new Date().toISOString();
      return "owner";
    });
    await deliverMobilePush();
    expect(b.fetch).not.toHaveBeenCalled();
    expect(deliveries().every((row) => row.status === "skipped")).toBe(true);
  });
  it("revalidates Books permissions for legacy receipt notification names", async () => {
    b.tables.notifications[0]!.type = "ReceiptProcessed";
    b.tables.notifications[0]!.entity_type = "receipt";
    b.role.mockResolvedValue("employee");
    await deliverMobilePush();
    expect(b.fetch).not.toHaveBeenCalled();
  });
  it("does not submit a token reassigned to another account during fan-out", async () => {
    b.tables.mobile_devices[1]!.enabled = false;
    let calls = 0;
    b.role.mockImplementation(async () => {
      calls++;
      if (calls === 3) b.tables.mobile_devices[0]!.user_id = "99999999-9999-4999-8999-999999999999";
      return "owner";
    });
    await deliverMobilePush();
    expect(b.fetch).not.toHaveBeenCalled();
    expect(deliveries()[0]?.status).toBe("skipped");
  });
});
