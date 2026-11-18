// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import type { ModuleKey } from "@/lib/domain/database-enums";
import { branded } from "@/types/ids";
import { collectInsightFacts } from "@/server/application/insights/facts";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));
vi.mock("@/server/foundation/module-installations/index", () => ({ getInstalledModules: vi.fn() }));
vi.mock("@/server/foundation/workspaces/index", () => ({ getWorkspace: vi.fn() }));

/**
 * The real services and Supabase query builder run here; only the HTTP transport is
 * replaced. So each test sees exactly which reads a member's facts cause, and with which
 * workspace, date and section flags.
 */

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000f1");
const ALL_MODULES: ModuleKey[] = ["invoices", "books", "drive", "quotes"];
const SYDNEY = { timezone: "Australia/Sydney", defaultCurrency: "AUD", fyStartMonth: 7 };
/** 07:30 on Thursday 19 November 2026 in Sydney. */
const MORNING = new Date("2026-11-18T20:30:00Z");
/** 09:00 on 15 October 2026 in Sydney: the month after the July-September quarter. */
const OCTOBER = new Date("2026-10-14T22:00:00Z");

type Recorded = { method: string; path: string; search: URLSearchParams; body: unknown };
const requests: Recorded[] = [];
let documentFacts: unknown;
let receiptCount: number;
let bookSummary: Record<string, unknown>;
let taxPeriods: Record<string, unknown>[];
let failing: string | null;

const noGst = {
  incomeCents: 0,
  expenseCents: 0,
  netCents: 0,
  gstCollectedCents: 0,
  gstPaidCents: 0,
  netGstCents: 0,
  count: 0,
  byCategory: [],
  monthly: [],
};

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  failing = null;
  receiptCount = 4;
  bookSummary = noGst;
  taxPeriods = [];
  documentFacts = {
    invoices: {
      overdueCount: 2,
      overdueCents: 35050,
      dueSoonCount: 1,
      dueSoonCents: 5000,
      draftCount: 3,
    },
    quotes: { acceptedCount: 1, acceptedCents: 90000, expiringCount: 2, expiringCents: 3000 },
  };
  vi.mocked(getWorkspace).mockResolvedValue(null);
  vi.mocked(getInstalledModules).mockResolvedValue([]);
  vi.mocked(getDataClient).mockReturnValue(
    createClient<Database>("https://insight-facts.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          const path = url.pathname.replace("/rest/v1/", "");
          const method = init?.method ?? "GET";
          requests.push({
            method,
            path,
            search: url.searchParams,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          });
          if (failing === path) {
            return new Response(JSON.stringify({ code: "42883", message: "function missing" }), {
              status: 404,
              headers: { "content-type": "application/json" },
            });
          }
          if (path === "rpc/get_insight_facts") return json(documentFacts);
          if (path === "rpc/get_book_summary") return json(bookSummary);
          if (path === "tax_periods") return json(taxPeriods);
          if (path === "receipt_extractions") {
            return new Response(null, {
              status: 200,
              headers: { "content-range": `*/${receiptCount}` },
            });
          }
          throw new Error(`Unexpected request: ${method} ${path}`);
        },
      },
    }),
  );
});

function collect(
  role: Parameters<typeof collectInsightFacts>[0]["role"],
  installedModules: ModuleKey[] = ALL_MODULES,
  now: Date = MORNING,
  workspace: Record<string, unknown> | null = SYDNEY,
) {
  return collectInsightFacts(
    { workspaceId: WORKSPACE_ID, role },
    { now, workspace, installedModules },
  );
}

const paths = () => requests.map((request) => request.path);
const factsCall = () => requests.find((request) => request.path === "rpc/get_insight_facts");

describe("collectInsightFacts", () => {
  it("returns every fact for an owner, from the member's workspace only", async () => {
    const facts = await collect("owner");

    expect(facts).toEqual({
      asOf: "2026-11-18T20:30:00.000Z",
      today: "2026-11-19",
      timezone: "Australia/Sydney",
      currency: "AUD",
      overdueInvoices: { count: 2, totalCents: 35050 },
      invoicesDueSoon: { count: 1, totalCents: 5000 },
      draftInvoices: { count: 3 },
      acceptedQuotes: { count: 1, totalCents: 90000 },
      quotesExpiringSoon: { count: 2, totalCents: 3000 },
      receiptsToReview: { count: 4 },
      gstToLodge: null,
    });
    expect(factsCall()!.body).toEqual({
      p_workspace_id: WORKSPACE_ID,
      p_today: "2026-11-19",
      p_include_invoices: true,
      p_include_quotes: true,
      p_days: 7,
    });
    const receipts = requests.find((request) => request.path === "receipt_extractions")!;
    expect(receipts.method).toBe("HEAD");
    expect(receipts.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(receipts.search.get("status")).toBe("eq.pending");
  });

  it("uses the workspace's local date as today, across the midnight boundary", async () => {
    const today = async (now: string, timezone: string) => {
      requests.length = 0;
      const facts = await collect("owner", ["invoices"], new Date(now), { ...SYDNEY, timezone });
      expect(factsCall()!.body).toMatchObject({ p_today: facts.today });
      return facts.today;
    };
    // Sydney's midnight is 13:00 UTC in November.
    expect(await today("2026-11-19T12:59:59Z", "Australia/Sydney")).toBe("2026-11-19");
    expect(await today("2026-11-19T13:00:00Z", "Australia/Sydney")).toBe("2026-11-20");
    // The same two instants are one calendar day in UTC and in Los Angeles.
    expect(await today("2026-11-19T12:59:59Z", "UTC")).toBe("2026-11-19");
    expect(await today("2026-11-19T13:00:00Z", "UTC")).toBe("2026-11-19");
    expect(await today("2026-11-19T13:00:00Z", "America/Los_Angeles")).toBe("2026-11-19");
    // Early morning in Sydney is still the previous evening in UTC.
    expect(await today("2026-11-18T20:30:00Z", "Australia/Sydney")).toBe("2026-11-19");
    expect(await today("2026-11-18T20:30:00Z", "UTC")).toBe("2026-11-18");
  });

  it("falls back to UTC and the defaults when the workspace timezone is unusable", async () => {
    const facts = await collect("owner", ["invoices"], MORNING, { timezone: "Not/AZone" });
    expect(facts).toMatchObject({ today: "2026-11-18", timezone: "UTC", currency: "AUD" });
    const missing = await collect("owner", ["invoices"], MORNING, null);
    expect(missing).toMatchObject({ today: "2026-11-18", timezone: "UTC", currency: "AUD" });
  });

  it("gives an employee no Books facts and makes no Books read", async () => {
    const facts = await collect("employee", ALL_MODULES, OCTOBER);

    expect(facts.receiptsToReview).toBeNull();
    expect(facts.gstToLodge).toBeNull();
    expect(facts.overdueInvoices).toEqual({ count: 2, totalCents: 35050 });
    expect(paths()).toEqual(["rpc/get_insight_facts"]);
  });

  it("lets a manager and a read-only member see GST but not the receipt queue", async () => {
    bookSummary = { ...noGst, gstCollectedCents: 50000, gstPaidCents: 20000, netGstCents: 30000 };
    for (const role of ["manager", "readonly"] as const) {
      requests.length = 0;
      const facts = await collect(role, ALL_MODULES, OCTOBER);
      expect(facts.receiptsToReview).toBeNull();
      expect(facts.gstToLodge).toEqual({ periodLabel: "2026-Q1", netGstCents: 30000 });
      expect(paths()).not.toContain("receipt_extractions");
    }
  });

  it("leaves out the facts of a module that is not installed", async () => {
    // The stand-in database still returns an invoice section; it must not get through.
    const facts = await collect("owner", ["quotes"]);

    expect(factsCall()!.body).toMatchObject({ p_include_invoices: false, p_include_quotes: true });
    expect(facts).toMatchObject({
      overdueInvoices: null,
      invoicesDueSoon: null,
      draftInvoices: null,
      acceptedQuotes: { count: 1, totalCents: 90000 },
      receiptsToReview: null,
      gstToLodge: null,
    });
    expect(paths()).toEqual(["rpc/get_insight_facts"]);
  });

  it("reads nothing at all when no module is installed", async () => {
    const facts = await collect("owner", [], OCTOBER);

    expect(requests).toHaveLength(0);
    expect(facts).toMatchObject({
      overdueInvoices: null,
      acceptedQuotes: null,
      receiptsToReview: null,
      gstToLodge: null,
    });
  });

  it("reads only the receipt queue when Books is the only module, outside a GST month", async () => {
    const facts = await collect("accountant", ["books"]);

    expect(facts.receiptsToReview).toEqual({ count: 4 });
    expect(paths()).toEqual(["receipt_extractions"]);
  });

  it("loads the workspace and modules itself when the caller has not", async () => {
    vi.mocked(getWorkspace).mockResolvedValue({
      ...SYDNEY,
      timezone: "America/Los_Angeles",
      defaultCurrency: "USD",
    } as never);
    vi.mocked(getInstalledModules).mockResolvedValue(["invoices"]);

    const facts = await collectInsightFacts(
      { workspaceId: WORKSPACE_ID, role: "owner" },
      { now: MORNING },
    );

    expect(getWorkspace).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(getInstalledModules).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(facts).toMatchObject({
      today: "2026-11-18",
      timezone: "America/Los_Angeles",
      currency: "USD",
      acceptedQuotes: null,
    });
  });

  it("does not present a failed read as nothing to report", async () => {
    failing = "rpc/get_insight_facts";
    await expect(collect("owner")).rejects.toThrow(/PostgREST error/);
  });
});

describe("collectInsightFacts: GST to lodge", () => {
  const withGst = {
    ...noGst,
    gstCollectedCents: 150000,
    gstPaidCents: 26600,
    netGstCents: 123400,
  };

  it("reports last quarter's GST in the month after it ends, until it is lodged", async () => {
    bookSummary = withGst;
    const facts = await collect("owner", ["books"], OCTOBER);

    expect(facts.gstToLodge).toEqual({ periodLabel: "2026-Q1", netGstCents: 123400 });
    const summary = requests.find((request) => request.path === "rpc/get_book_summary")!;
    // The whole July-September quarter, for this workspace.
    expect(summary.body).toMatchObject({
      p_workspace_id: WORKSPACE_ID,
      p_date_from: "2026-07-01T00:00:00.000Z",
      p_date_to: "2026-09-30T23:59:59.999Z",
    });
    const lodgements = requests.find((request) => request.path === "tax_periods")!;
    expect(lodgements.search.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
  });

  it("says nothing once the quarter is marked as lodged", async () => {
    bookSummary = withGst;
    const period = {
      id: "00000000-0000-4000-8000-0000000000f2",
      workspace_id: WORKSPACE_ID,
      fiscal_year: 2026,
      quarter: 1,
      period_label: "2026-Q1",
      gst_collected_cents: 150000,
      gst_paid_cents: 26600,
      net_gst_cents: 123400,
      lodged_at: "2026-10-10T01:00:00",
      created_at: "2026-10-10T01:00:00",
      updated_at: "2026-10-10T01:00:00",
    };
    taxPeriods = [period];
    expect((await collect("owner", ["books"], OCTOBER)).gstToLodge).toBeNull();

    // An older lodged quarter does not count for this one.
    taxPeriods = [{ ...period, quarter: 4, fiscal_year: 2025, period_label: "2025-Q4" }];
    expect((await collect("owner", ["books"], OCTOBER)).gstToLodge).toEqual({
      periodLabel: "2026-Q1",
      netGstCents: 123400,
    });
  });

  it("reports a refund as a negative amount", async () => {
    bookSummary = { ...noGst, gstCollectedCents: 1000, gstPaidCents: 21000, netGstCents: -20000 };
    expect((await collect("owner", ["books"], OCTOBER)).gstToLodge).toEqual({
      periodLabel: "2026-Q1",
      netGstCents: -20000,
    });
  });

  it("skips a quarter with no GST recorded without looking up lodgements", async () => {
    const facts = await collect("owner", ["books"], OCTOBER);

    expect(facts.gstToLodge).toBeNull();
    expect(paths()).toContain("rpc/get_book_summary");
    expect(paths()).not.toContain("tax_periods");
  });

  it("makes no GST read outside the month after a quarter ends", async () => {
    bookSummary = withGst;
    // 19 November and 1 September (Sydney) are both mid-quarter for a July year.
    for (const now of [MORNING, new Date("2026-08-31T22:00:00Z")]) {
      requests.length = 0;
      expect((await collect("owner", ["books"], now)).gstToLodge).toBeNull();
      expect(paths()).toEqual(["receipt_extractions"]);
    }
  });

  it("decides the month from the workspace's local date", async () => {
    bookSummary = withGst;
    // 20:30 UTC on 30 September is already 1 October in Sydney, but not yet in UTC.
    const now = new Date("2026-09-30T20:30:00Z");
    expect((await collect("owner", ["books"], now)).gstToLodge).toEqual({
      periodLabel: "2026-Q1",
      netGstCents: 123400,
    });
    expect(
      (await collect("owner", ["books"], now, { ...SYDNEY, timezone: "UTC" })).gstToLodge,
    ).toBeNull();
  });
});
