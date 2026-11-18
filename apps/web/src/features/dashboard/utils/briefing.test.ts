// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { collectInsightFacts } from "@/server/application/insights/facts";
import type { InsightFacts } from "@/lib/domain/insights/facts";
import { branded } from "@/types/ids";
import { loadDashboardPage } from "@/features/dashboard/api/actions";

vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: vi.fn(),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({ getInstalledModules: vi.fn() }));
vi.mock("@/server/foundation/workspaces/index", () => ({
  getWorkspace: vi.fn().mockResolvedValue({
    name: "Briefing workspace",
    defaultCurrency: "AUD",
    fyStartMonth: 7,
    timezone: "Australia/Sydney",
  }),
}));
vi.mock("@/server/foundation/customers/index", () => ({
  countCustomers: vi.fn().mockResolvedValue(3),
}));
vi.mock("@/server/foundation/activity/index", () => ({
  listActivity: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
}));
// The invoice summary feeds the KPI and module cards only; the briefing and the
// "Needs attention" list must come from the insight facts.
vi.mock("@/server/domains/invoices/index", () => ({
  countNonDraftInvoices: vi.fn().mockResolvedValue(0),
  getInvoiceDashboardSummary: vi.fn().mockResolvedValue({
    outstandingCents: 0,
    overdueCount: 99,
    overdueCents: 9999900,
    draftCount: 99,
    paidCents: 0,
    paidCount: 0,
    sentCount: 0,
    previousPaidCents: 0,
    monthly: [],
  }),
}));
vi.mock("@/server/application/insights/facts", () => ({ collectInsightFacts: vi.fn() }));

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000e1");

function facts(overrides: Partial<InsightFacts> = {}): InsightFacts {
  return {
    asOf: "2026-11-18T20:41:00.000Z",
    today: "2026-11-19",
    timezone: "Australia/Sydney",
    currency: "AUD",
    overdueInvoices: { count: 0, totalCents: 0 },
    invoicesDueSoon: { count: 0, totalCents: 0 },
    draftInvoices: { count: 0 },
    acceptedQuotes: null,
    quotesExpiringSoon: null,
    receiptsToReview: null,
    gstToLodge: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWorkspaceContext).mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    role: "manager",
    user: { id: branded<"UserId">("manager"), email: "manager@example.test" },
  });
  vi.mocked(getInstalledModules).mockResolvedValue(["invoices"]);
  vi.mocked(collectInsightFacts).mockResolvedValue(facts());
});

describe("dashboard briefing", () => {
  it("asks for the signed-in member's facts, reusing the workspace it already loaded", async () => {
    await loadDashboardPage();

    expect(collectInsightFacts).toHaveBeenCalledTimes(1);
    expect(collectInsightFacts).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, role: "manager" },
      {
        workspace: expect.objectContaining({ timezone: "Australia/Sydney" }),
        installedModules: ["invoices"],
      },
    );
  });

  it("builds the headline, the links and the attention list from those facts", async () => {
    vi.mocked(collectInsightFacts).mockResolvedValue(
      facts({
        overdueInvoices: { count: 2, totalCents: 35050 },
        invoicesDueSoon: { count: 1, totalCents: 5000 },
        draftInvoices: { count: 1 },
      }),
    );
    const dashboard = await loadDashboardPage();

    expect(dashboard.briefing).toEqual({
      headline:
        "2 invoices are overdue ($350.50) and 1 more is due in the next 7 days ($50.00). " +
        "Also waiting: 1 draft invoice.",
      asOf: "2026-11-18T20:41:00.000Z",
      asOfLabel: expect.stringMatching(/^19 Nov, 7:41 am$/i),
      links: [
        { id: "overdue-invoices", label: "Review overdue", href: "/invoices?status=overdue" },
        { id: "invoices-due-soon", label: "View invoices", href: "/invoices" },
        { id: "draft-invoices", label: "Finish drafts", href: "/invoices?status=draft" },
      ],
    });
    // The summary's own counts (99) are not what the list shows.
    expect(dashboard.attentionItems.map((item) => item.title)).toEqual([
      "2 overdue invoices",
      "1 draft invoice",
    ]);
  });

  it("says there is nothing to report, with no links, when nothing is waiting", async () => {
    const dashboard = await loadDashboardPage();

    expect(dashboard.briefing).toMatchObject({
      headline: "Nothing needs your attention right now.",
      links: [],
    });
    expect(dashboard.attentionItems).toEqual([]);
  });

  it("has no briefing while no module is installed", async () => {
    vi.mocked(getInstalledModules).mockResolvedValue([]);
    const dashboard = await loadDashboardPage();

    expect(dashboard.onboarding).toBe(true);
    expect(dashboard.briefing).toBeNull();
    expect(dashboard.attentionItems).toEqual([]);
  });

  it("still loads, without claiming nothing is waiting, when the facts cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(collectInsightFacts).mockRejectedValue(new Error("function does not exist"));

    const dashboard = await loadDashboardPage();

    expect(dashboard.insightsUnavailable).toBe(true);
    expect(dashboard.briefing).toBeNull();
    expect(dashboard.attentionItems).toEqual([]);
    expect(dashboard.kpis.length).toBeGreaterThan(0);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
