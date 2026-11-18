// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/server/infrastructure/db/types";
import { getDataClient } from "@/server/infrastructure/db/client";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { countCustomers } from "@/server/foundation/customers/index";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { branded } from "@/types/ids";
import { loadDashboardPage } from "@/features/dashboard/api/actions";

vi.mock("@/server/infrastructure/db/client", () => ({ getDataClient: vi.fn() }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: vi.fn(),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({ getInstalledModules: vi.fn() }));
vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: vi.fn().mockResolvedValue({
    name: "Receipt review workspace",
    defaultCurrency: "AUD",
    fyStartMonth: 7,
  }),
}));
vi.mock("@/server/foundation/customers/index", () => ({
  countCustomers: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/server/foundation/activity/index", () => ({
  listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
vi.mock("@/server/domains/books/index", () => ({
  getBookSummary: vi.fn().mockResolvedValue({
    incomeCents: 0,
    expenseCents: 0,
    netCents: 0,
    count: 0,
    monthly: [],
  }),
}));

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-000000000001");
const requests: Array<{ url: URL; method: string; headers: Headers }> = [];
let receiptCount: number;
let responseStatus: number;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(countCustomers).mockResolvedValue(0);
  requests.length = 0;
  receiptCount = 137;
  responseStatus = 200;
  vi.mocked(requireWorkspaceContext).mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    role: "owner",
    user: { id: branded<"UserId">("owner"), email: "owner@example.test" },
  });
  vi.mocked(getInstalledModules).mockResolvedValue(["books"]);
  // Exercise the real receipt service and Supabase query builder. Replace only
  // HTTP transport so no database, storage, or AI service is contacted.
  vi.mocked(getDataClient).mockReturnValue(
    createClient<Database>("https://receipt-count.example.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          requests.push({
            url: new URL(String(input)),
            method: init?.method ?? "GET",
            headers: new Headers(init?.headers),
          });
          return new Response(init?.method === "HEAD" ? null : "[]", {
            status: responseStatus,
            statusText: responseStatus === 200 ? "OK" : "Forbidden",
            headers: { "content-range": `*/${receiptCount}` },
          });
        },
      },
    }),
  );
});

describe("dashboard receipt review count", () => {
  it("shows the complete queue above the list limit without fetching receipt rows", async () => {
    const dashboard = await loadDashboardPage();

    expect(dashboard.attentionItems).toContainEqual(
      expect.objectContaining({ id: "pending-receipts", title: "137 receipts need review" }),
    );
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("HEAD");
    expect(request.url.pathname).toBe("/rest/v1/receipt_extractions");
    expect(request.url.searchParams.get("workspace_id")).toBe(`eq.${WORKSPACE_ID}`);
    expect(request.url.searchParams.get("status")).toBe("eq.pending");
    expect(request.url.searchParams.has("limit")).toBe(false);
    expect(request.headers.get("prefer")).toContain("count=exact");
  });

  it("uses singular wording for one pending receipt", async () => {
    receiptCount = 1;
    const dashboard = await loadDashboardPage();

    expect(dashboard.attentionItems).toContainEqual(
      expect.objectContaining({ id: "pending-receipts", title: "1 receipt needs review" }),
    );
  });

  it("omits the review action for an empty queue", async () => {
    receiptCount = 0;
    const dashboard = await loadDashboardPage();

    expect(dashboard.attentionItems.some((item) => item.id === "pending-receipts")).toBe(false);
  });

  it("does not read the receipt queue for a role that cannot manage Books", async () => {
    vi.mocked(requireWorkspaceContext).mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      role: "readonly",
      user: { id: branded<"UserId">("viewer"), email: "viewer@example.test" },
    });
    const dashboard = await loadDashboardPage();

    expect(dashboard.attentionItems.some((item) => item.id === "pending-receipts")).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("does not read the receipt queue when Books is disabled", async () => {
    vi.mocked(getInstalledModules).mockResolvedValue([]);
    const dashboard = await loadDashboardPage();

    expect(dashboard.attentionItems.some((item) => item.id === "pending-receipts")).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("does not present a failed count query as an empty review queue", async () => {
    responseStatus = 403;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // The page still loads, flagged so it shows "could not be loaded" where the list would
    // be, never "all caught up".
    const dashboard = await loadDashboardPage();

    expect(dashboard.insightsUnavailable).toBe(true);
    expect(dashboard.briefing).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      "[dashboard] insight facts unavailable",
      expect.objectContaining({ message: expect.stringMatching(/PostgREST error/) }),
    );
    logged.mockRestore();
  });
});
