// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEmailClientForTest, setEmailClientForTest } from "@/server/infrastructure/email";
import type { EmailPayload } from "@/lib/domain/notifications/email-transport-types";
import type { AiDigestFrequency, WorkspaceRole } from "@/lib/domain/database-enums";
import type { InsightFacts } from "@/lib/domain/insights/facts";
import { localDate } from "@/lib/domain/insights/local-date";
import { GET } from "@/server/application/http/api/cron/assistant-digest/handler";

/**
 * The cron route end to end, with the database replaced by an in-memory stand-in. The
 * stand-in's claim follows the same rule as `claim_ai_digests` (opted in, 07:00 or later
 * local time, Monday for weekly, not yet picked this period); the SQL itself is covered by
 * `briefings.migration.test.ts`. Email goes through the real `sendEmail` with a fake client.
 */

type Member = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  email: string;
  frequency: AiDigestFrequency;
  lastPeriod: string | null;
};

const h = vi.hoisted(() => ({
  env: {
    CRON_SECRET: "cron-secret" as string | undefined,
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
  },
  members: [] as Member[],
  timezones: {} as Record<string, string>,
  claimCalls: [] as number[],
  notifications: [] as Array<{
    workspaceId: string;
    userId: string;
    type: string;
    title: string;
    body?: string;
  }>,
  factsCalls: [] as Array<{ workspaceId: string; role: string }>,
  factsByRole: {} as Record<string, unknown>,
  failFactsOnce: new Set<string>(),
  failNotificationFor: new Set<string>(),
  onNotification: null as (() => void) | null,
}));

vi.mock("@/server/infrastructure/config/env", () => ({ env: h.env }));

vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: vi.fn(async (workspaceId: string) => ({
    id: workspaceId,
    name: workspaceId === "ws-sydney" ? "Sydney Co" : "Acme Plumbing",
    timezone: h.timezones[workspaceId] ?? "UTC",
    defaultCurrency: "AUD",
    fyStartMonth: 7,
  })),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  getInstalledModules: vi.fn(async () => ["invoices", "books", "quotes"]),
}));

vi.mock("@/server/foundation/notifications/digest-preferences", () => {
  const clock = (now: Date, timezone: string) => {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" })
        .formatToParts(now)
        .find((part) => part.type === "hour")!.value,
    );
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    return { hour, date, monday: new Date(`${date}T00:00:00Z`).getUTCDay() === 1 };
  };
  return {
    claimDueDigests: vi.fn(async (now: Date, limit: number) => {
      h.claimCalls.push(limit);
      const claims = [];
      for (const member of h.members) {
        if (claims.length >= limit) break;
        const local = clock(now, h.timezones[member.workspaceId] ?? "UTC");
        const due =
          member.frequency !== "off" &&
          local.hour >= 7 &&
          (member.frequency === "daily" || local.monday) &&
          (member.lastPeriod === null || member.lastPeriod < local.date);
        if (!due) continue;
        claims.push({
          workspaceId: member.workspaceId,
          userId: member.userId,
          frequency: member.frequency,
          period: local.date,
          previousPeriod: member.lastPeriod,
          role: member.role,
          email: member.email,
        });
        member.lastPeriod = local.date;
      }
      return claims;
    }),
    releaseDigestClaim: vi.fn(
      async (claim: {
        workspaceId: string;
        userId: string;
        period: string;
        previousPeriod: string | null;
      }) => {
        const member = h.members.find(
          (m) => m.workspaceId === claim.workspaceId && m.userId === claim.userId,
        );
        if (member && member.lastPeriod === claim.period) member.lastPeriod = claim.previousPeriod;
      },
    ),
  };
});

vi.mock("@/server/foundation/notifications/store", () => ({
  createNotification: vi.fn(
    async (input: {
      workspaceId: string;
      userId: string;
      type: string;
      title: string;
      body?: string;
    }) => {
      if (h.failNotificationFor.has(input.userId)) throw new Error("insert failed");
      h.onNotification?.();
      h.notifications.push(input);
      return "notification-id";
    },
  ),
}));

vi.mock("@/server/application/insights/facts", () => ({
  collectInsightFacts: vi.fn(
    async (member: { workspaceId: string; role: string }, options: { now: Date }) => {
      h.factsCalls.push({ workspaceId: member.workspaceId, role: member.role });
      if (h.failFactsOnce.delete(member.role)) throw new Error("database unavailable");
      const facts = (h.factsByRole[member.role] ?? h.factsByRole.default) as Record<
        string,
        unknown
      >;
      const timezone = h.timezones[member.workspaceId] ?? "UTC";
      return { ...facts, asOf: options.now.toISOString(), timezone };
    },
  ),
}));

function facts(overrides: Partial<InsightFacts> = {}): InsightFacts {
  return {
    asOf: "",
    today: "2026-11-19",
    timezone: "UTC",
    currency: "AUD",
    overdueInvoices: { count: 0, totalCents: 0 },
    invoicesDueSoon: { count: 0, totalCents: 0 },
    draftInvoices: { count: 0 },
    acceptedQuotes: { count: 0, totalCents: 0 },
    quotesExpiringSoon: { count: 0, totalCents: 0 },
    receiptsToReview: { count: 0 },
    gstToLodge: null,
    ...overrides,
  };
}

const OVERDUE = facts({ overdueInvoices: { count: 2, totalCents: 35050 } });
const NOTHING = facts();

function member(userId: string, overrides: Partial<Member> = {}): Member {
  return {
    workspaceId: "ws-acme",
    userId,
    role: "owner",
    email: `${userId}@example.test`,
    frequency: "daily",
    lastPeriod: null,
    ...overrides,
  };
}

let sends: EmailPayload[];
let failEmailTo: Set<string>;

function run(headers: Record<string, string> = { authorization: "Bearer cron-secret" }) {
  return GET(new Request("https://app.example.test/api/cron/assistant-digest", { headers }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Thursday 19 November 2026, 08:07 UTC.
  vi.setSystemTime(new Date("2026-11-19T08:07:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.env.CRON_SECRET = "cron-secret";
  h.members = [];
  h.timezones = {};
  h.claimCalls = [];
  h.notifications = [];
  h.factsCalls = [];
  h.factsByRole = { default: OVERDUE };
  h.failFactsOnce = new Set();
  h.failNotificationFor = new Set();
  h.onNotification = null;
  sends = [];
  failEmailTo = new Set();
  setEmailClientForTest({
    async send(payload) {
      if (failEmailTo.has(payload.to)) throw new Error("mailbox rejected");
      sends.push(payload);
      return { id: "re_test" };
    },
  });
});

afterEach(() => {
  clearEmailClientForTest();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GET /api/cron/assistant-digest: authorization", () => {
  beforeEach(() => {
    h.members = [member("ada")];
  });

  it("answers 500 and sends nothing when the cron secret is not configured", async () => {
    h.env.CRON_SECRET = undefined;
    const response = await run();

    expect(response.status).toBe(500);
    expect(h.claimCalls).toEqual([]);
    expect(h.notifications).toEqual([]);
    expect(sends).toEqual([]);
  });

  it("answers 401 and sends nothing without the right secret", async () => {
    const attempts: Record<string, string>[] = [
      {},
      { authorization: "Bearer wrong-secret" },
      { authorization: "Bearer x" },
      { authorization: "cron-secret" },
      { "x-cron-secret": "wrong-secret" },
    ];
    for (const headers of attempts) {
      const response = await run(headers);
      expect(response.status).toBe(401);
    }
    expect(h.claimCalls).toEqual([]);
    expect(h.notifications).toEqual([]);
    expect(sends).toEqual([]);
  });

  it("runs for the bearer secret Vercel sends, and for the x-cron-secret header", async () => {
    const first = await run({ authorization: "Bearer cron-secret" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      claimed: 1,
      sent: 1,
      emailed: 1,
      skipped: 0,
      failed: 0,
    });

    const second = await run({ "x-cron-secret": "cron-secret" });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, claimed: 0, sent: 0 });
  });
});

describe("GET /api/cron/assistant-digest: who is sent a digest", () => {
  it("sends an in-app notification and an email to a member who opted in", async () => {
    h.members = [member("ada")];
    await run();

    expect(h.notifications).toEqual([
      {
        workspaceId: "ws-acme",
        userId: "ada",
        type: "assistant.digest",
        title: "Your daily briefing",
        body: "2 invoices are overdue, totalling $350.50.",
      },
    ]);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({
      to: "ada@example.test",
      subject: "Your daily briefing for Acme Plumbing",
    });
    expect(sends[0]!.text).toContain("2 invoices are overdue, totalling $350.50 AUD.");
    expect(sends[0]!.text).toContain("https://app.example.test/invoices?status=overdue");
    expect(sends[0]!.text).toContain("https://app.example.test/settings/assistant");
  });

  it("never sends to members who have not turned the digest on", async () => {
    h.members = [
      member("off", { frequency: "off" }),
      member("ada"),
      member("also-off", { frequency: "off" }),
    ];
    const response = await run();

    expect(await response.json()).toMatchObject({ claimed: 1, sent: 1, emailed: 1 });
    expect(h.notifications.map((n) => n.userId)).toEqual(["ada"]);
    expect(sends.map((s) => s.to)).toEqual(["ada@example.test"]);
    expect(h.factsCalls).toHaveLength(1);
  });

  it("sends nothing to a member with nothing to report, and does not ask again that day", async () => {
    h.factsByRole = { default: NOTHING, owner: OVERDUE };
    h.members = [member("quiet", { role: "employee" }), member("ada")];
    const first = await run();

    expect(await first.json()).toEqual({
      ok: true,
      claimed: 2,
      sent: 1,
      emailed: 1,
      skipped: 1,
      failed: 0,
    });
    expect(h.notifications.map((n) => n.userId)).toEqual(["ada"]);
    expect(sends.map((s) => s.to)).toEqual(["ada@example.test"]);

    // An hour later something is overdue for them, but today's digest has had its turn.
    h.factsByRole = { default: OVERDUE };
    vi.setSystemTime(new Date("2026-11-19T09:07:00Z"));
    expect(await (await run()).json()).toMatchObject({ claimed: 0, sent: 0, skipped: 0 });
    expect(h.notifications).toHaveLength(1);
  });

  it("builds each member's digest from their own workspace and role", async () => {
    h.factsByRole = {
      default: OVERDUE,
      employee: facts({
        overdueInvoices: { count: 1, totalCents: 9900 },
        receiptsToReview: null,
        gstToLodge: null,
      }),
      accountant: facts({ receiptsToReview: { count: 3 } }),
    };
    h.members = [
      member("eve", { role: "employee" }),
      member("ann", { role: "accountant", workspaceId: "ws-other" }),
    ];
    await run();

    expect(h.factsCalls).toEqual(
      expect.arrayContaining([
        { workspaceId: "ws-acme", role: "employee" },
        { workspaceId: "ws-other", role: "accountant" },
      ]),
    );
    const bodyFor = (userId: string) => h.notifications.find((n) => n.userId === userId)!.body;
    expect(bodyFor("eve")).toBe("1 invoice is overdue, totalling $99.00.");
    expect(bodyFor("ann")).toBe("Waiting for you: 3 receipts to review.");
    const emailFor = (to: string) => sends.find((s) => s.to === to)!.text;
    expect(emailFor("eve@example.test")).not.toContain("receipt");
    expect(emailFor("ann@example.test")).toContain("3 receipts need review.");
  });

  it("waits until 07:00 in the workspace's timezone", async () => {
    h.timezones = { "ws-sydney": "Australia/Sydney" };
    h.members = [member("syd", { workspaceId: "ws-sydney" })];
    // 19:30 UTC is 06:30 the next morning in Sydney.
    vi.setSystemTime(new Date("2026-11-18T19:30:00Z"));
    expect(await (await run()).json()).toMatchObject({ claimed: 0 });
    vi.setSystemTime(new Date("2026-11-18T20:07:00Z"));
    expect(await (await run()).json()).toMatchObject({ claimed: 1, sent: 1 });
    expect(h.members[0]!.lastPeriod).toBe(localDate(new Date(), "Australia/Sydney").date);
    expect(sends[0]!.subject).toBe("Your daily briefing for Sydney Co");
    expect(sends[0]!.text).toMatch(/As of 19 Nov, 7:07 am \(Australia\/Sydney\)/i);
  });

  it("sends a weekly digest on Monday only, worded as weekly", async () => {
    h.members = [member("wendy", { frequency: "weekly" })];
    // Thursday.
    expect(await (await run()).json()).toMatchObject({ claimed: 0 });
    // Monday 23 November 2026.
    vi.setSystemTime(new Date("2026-11-23T08:07:00Z"));
    expect(await (await run()).json()).toMatchObject({ claimed: 1, sent: 1, emailed: 1 });
    expect(h.notifications[0]!.title).toBe("Your weekly briefing");
    expect(sends[0]!.subject).toBe("Your weekly briefing for Acme Plumbing");
    // Tuesday.
    vi.setSystemTime(new Date("2026-11-24T08:07:00Z"));
    expect(await (await run()).json()).toMatchObject({ claimed: 0 });
  });
});

describe("GET /api/cron/assistant-digest: at most once", () => {
  it("sends nothing on a second run in the same period", async () => {
    h.members = [member("ada"), member("bob")];
    await run();
    await run();
    vi.setSystemTime(new Date("2026-11-19T23:07:00Z"));
    await run();

    expect(h.notifications.map((n) => n.userId).sort()).toEqual(["ada", "bob"]);
    expect(sends.map((s) => s.to).sort()).toEqual(["ada@example.test", "bob@example.test"]);
  });

  it("sends once when two runs overlap", async () => {
    h.members = [member("ada"), member("bob"), member("cy")];
    const results = await Promise.all([run(), run(), run()]);
    const totals = await Promise.all(results.map((response) => response.json()));

    expect(totals.reduce((sum, body) => sum + body.claimed, 0)).toBe(3);
    expect(h.notifications.map((n) => n.userId).sort()).toEqual(["ada", "bob", "cy"]);
    expect(sends.map((s) => s.to).sort()).toEqual([
      "ada@example.test",
      "bob@example.test",
      "cy@example.test",
    ]);
  });

  it("sends again the next day", async () => {
    h.members = [member("ada")];
    await run();
    vi.setSystemTime(new Date("2026-11-20T08:07:00Z"));
    await run();

    expect(h.notifications).toHaveLength(2);
    expect(sends).toHaveLength(2);
  });
});

describe("GET /api/cron/assistant-digest: failures", () => {
  it("keeps the in-app notification and the other recipients when one email fails", async () => {
    h.members = [member("ada"), member("bob"), member("cy")];
    failEmailTo.add("bob@example.test");
    const response = await run();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      claimed: 3,
      sent: 3,
      emailed: 2,
      skipped: 0,
      failed: 0,
    });
    expect(h.notifications.map((n) => n.userId).sort()).toEqual(["ada", "bob", "cy"]);
    expect(sends.map((s) => s.to).sort()).toEqual(["ada@example.test", "cy@example.test"]);
    // The failed email is not retried: the member already has the notification.
    await run();
    expect(h.notifications).toHaveLength(3);
    expect(sends).toHaveLength(2);
  });

  it("does the in-app part only when email is not configured", async () => {
    setEmailClientForTest(null);
    h.members = [member("ada"), member("bob")];
    const response = await run();

    expect(await response.json()).toMatchObject({ claimed: 2, sent: 2, emailed: 0, failed: 0 });
    expect(h.notifications).toHaveLength(2);
    expect(sends).toEqual([]);
  });

  it("hands a member back for the next run when their facts could not be read", async () => {
    h.members = [member("ada"), member("eve", { role: "employee" })];
    h.failFactsOnce.add("employee");
    const first = await run();

    expect(await first.json()).toMatchObject({ claimed: 2, sent: 1, emailed: 1, failed: 1 });
    expect(h.notifications.map((n) => n.userId)).toEqual(["ada"]);
    expect(h.members.find((m) => m.userId === "eve")!.lastPeriod).toBeNull();

    // The next hourly run retries only the member who got nothing.
    vi.setSystemTime(new Date("2026-11-19T09:07:00Z"));
    expect(await (await run()).json()).toMatchObject({
      claimed: 1,
      sent: 1,
      emailed: 1,
      failed: 0,
    });
    expect(h.notifications.map((n) => n.userId)).toEqual(["ada", "eve"]);
    expect(sends.map((s) => s.to)).toEqual(["ada@example.test", "eve@example.test"]);
  });

  it("does not email or retry a member whose notification could not be saved", async () => {
    h.members = [member("ada"), member("bob")];
    h.failNotificationFor.add("bob");
    const first = await run();

    expect(await first.json()).toMatchObject({ claimed: 2, sent: 1, emailed: 1, failed: 1 });
    expect(sends.map((s) => s.to)).toEqual(["ada@example.test"]);

    // The save may have reached the database, so a retry could show the digest twice.
    h.failNotificationFor.clear();
    expect(await (await run()).json()).toMatchObject({ claimed: 0, sent: 0 });
    expect(h.notifications.map((n) => n.userId)).toEqual(["ada"]);
  });
});

describe("GET /api/cron/assistant-digest: batching", () => {
  it("claims in batches until nobody is left", async () => {
    h.members = Array.from({ length: 60 }, (_, i) => member(`m${i}`));
    const response = await run();

    expect(await response.json()).toMatchObject({ claimed: 60, sent: 60, emailed: 60, failed: 0 });
    expect(h.claimCalls).toEqual([25, 25, 25]);
    expect(new Set(h.notifications.map((n) => n.userId)).size).toBe(60);
  });

  it("stops at the run limit and leaves the rest for the next run", async () => {
    h.members = Array.from({ length: 230 }, (_, i) => member(`m${i}`));
    const first = await run();

    expect(await first.json()).toMatchObject({ claimed: 200, sent: 200 });
    expect(h.claimCalls).toHaveLength(8);

    const second = await run();
    expect(await second.json()).toMatchObject({ claimed: 30, sent: 30 });
    expect(new Set(h.notifications.map((n) => n.userId)).size).toBe(230);
    expect(h.notifications).toHaveLength(230);
  });

  it("stops claiming once its time budget is used, so a cut-off run loses little", async () => {
    h.members = Array.from({ length: 80 }, (_, i) => member(`m${i}`));
    // Each notification takes two seconds: the first batch of 25 uses the 40-second budget.
    h.onNotification = () => vi.setSystemTime(Date.now() + 2_000);
    const first = await run();

    expect(await first.json()).toMatchObject({ claimed: 25, sent: 25, failed: 0 });
    expect(h.claimCalls).toEqual([25]);
    // Everyone claimed was sent to; the other 55 are untouched and still due.
    expect(h.members.filter((m) => m.lastPeriod !== null)).toHaveLength(25);
    expect(h.notifications).toHaveLength(25);
  });

  it("makes one database call when nobody is due", async () => {
    h.members = [member("off", { frequency: "off" })];
    const response = await run();

    expect(await response.json()).toEqual({
      ok: true,
      claimed: 0,
      sent: 0,
      emailed: 0,
      skipped: 0,
      failed: 0,
    });
    expect(h.claimCalls).toEqual([25]);
    expect(h.factsCalls).toEqual([]);
  });
});
