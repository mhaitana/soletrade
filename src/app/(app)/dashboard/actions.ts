"use server";

import { requireWorkspaceContext } from "@/platform/context";
import { getWorkspace } from "@/platform/workspaces";
import { getInstalledModules } from "@/platform/module-installations";
import { formatCents } from "@/platform/billing/pricing";
import { formatKm } from "@/modules/drive/calc";
import { listActivity, type ActivityPage } from "@/platform/activity";
import { periodRange, previousPeriodRange, parsePeriod, type Period } from "@/shared/utils/periods";
import { percentDelta, type Delta } from "@/shared/utils/delta";
import type { SparklinePoint } from "@/shared/components/sparkline";
import { MODULES, type ModuleKey } from "@/shared/constants/modules";
import type { WorkspaceId } from "@/shared/types/ids";
import { listInvoices, summarizeInvoices } from "@/modules/invoices";
import { listTransactions, summarizeTransactions } from "@/modules/books";
import { listEarnings, listTrips, summarizeDrive } from "@/modules/drive";
import { listQuotes, summarizeQuotes } from "@/modules/quotes";

/**
 * Cross-module dashboard loader (Phase 9). This is the **composition root** - it MAY import all
 * four module services (the services stay decoupled; no module→module import). It fans out to
 * each installed module's service + pure aggregator in parallel, for the current AND previous
 * period, then shapes the results into the dashboard's KPI cards + per-module summary cards +
 * recent activity.
 *
 * All scoping comes from the session-derived `workspaceId` (`requireWorkspaceContext`) - a
 * client-provided workspaceId is never trusted (per the brief's security constraints).
 *
 * The dashboard defaults to period `"month"` (Books/Drive pages default to `"year"`) so the
 * KPI deltas read "vs last month" per the design spec. For `"all"` there's no previous period,
 * so deltas are `null`. Current-state snapshots (outstanding invoices, overdue/draft counts,
 * pending-conversion quote value) have no delta - they're "right now".
 *
 * **KPI deltas** are computed only for the two period-bound headline KPIs (Books net = "Cash
 * position", Invoices paid = "Revenue this period"); the other two KPIs (Outstanding, Pending
 * quotes) are snapshots. Drive has no headline KPI in the 4-card row (per the spec), so its
 * previous period isn't fetched - its summary card shows current-period metrics + sparkline.
 */

const DASHBOARD_DEFAULT_PERIOD: Period = "month";
const CURRENCY = "AUD";

// --- Card data shapes (serializable - returned from the server action) ------

export interface KpiCardData {
  id: string;
  label: string;
  /** Formatted value string (e.g. "$1,234.56"), or null for the empty state. */
  value: string | null;
  /** Delta vs previous period, or null (snapshot metric / "all" period / no previous). */
  delta: Delta | null;
  /** Where the card links to (a module page or /settings/modules to enable). */
  href: string;
  /** Empty-state CTA text shown when `value` is null (e.g. "Enable Books"). */
  emptyLabel: string;
}

export interface ModuleMetric {
  label: string;
  value: string;
}

export interface ModuleCardData {
  key: ModuleKey;
  href: string;
  name: string;
  metrics: ModuleMetric[];
  sparkline: { points: SparklinePoint[]; ariaLabel: string } | null;
}

export interface DashboardData {
  period: Period;
  installedModules: ModuleKey[];
  kpis: KpiCardData[];
  moduleCards: ModuleCardData[];
  activity: ActivityPage;
  /** True when zero modules are installed - the page renders the onboarding stub instead. */
  onboarding: boolean;
}

// --- Per-module fetch + aggregate -------------------------------------------
// Each helper takes the session-resolved workspaceId (never a client value) and the current +
// previous ranges, fetches only the rows it needs, runs the pure aggregator, and shapes the
// card data. They run concurrently via Promise.all in the loader.

async function invoicesCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  previousRange: { start: Date; end: Date } | null,
): Promise<{
  outstanding: KpiCardData;
  revenue: KpiCardData;
  card: ModuleCardData;
}> {
  // listInvoices is capped at 200 and has no date-range filter - fetch once, bucket by date in
  // the pure aggregator (mirrors Books/Drive's "fetch rows + pure calc" pattern).
  const rows = await listInvoices(workspaceId, { limit: 200 });
  const toInput = rows.map((r) => ({
    status: r.status,
    totalCents: r.totalCents,
    sentAt: r.sentAt,
    paidAt: r.paidAt,
    issueDate: r.issueDate,
  }));
  const cur = summarizeInvoices(toInput, currentRange);
  const prev = previousRange ? summarizeInvoices(toInput, previousRange) : null;

  const outstanding: KpiCardData = {
    id: "outstanding",
    label: "Outstanding invoices",
    value: cur.outstandingCents > 0 ? formatCents(cur.outstandingCents, CURRENCY) : null,
    delta: null, // snapshot - no delta
    href: "/invoices",
    emptyLabel: "No outstanding invoices",
  };
  const revenue: KpiCardData = {
    id: "revenue",
    label: "Revenue this period",
    value: cur.paidCents > 0 ? formatCents(cur.paidCents, CURRENCY) : null,
    delta: prev ? percentDelta(cur.paidCents, prev.paidCents) : null,
    href: "/invoices",
    emptyLabel: "No paid invoices yet",
  };
  const card: ModuleCardData = {
    key: "invoices",
    href: "/invoices",
    name: MODULES.invoices.name,
    metrics: [
      { label: "Outstanding", value: formatCents(cur.outstandingCents, CURRENCY) },
      { label: "Overdue", value: String(cur.overdueCount) },
      { label: "Drafts", value: String(cur.draftCount) },
    ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: "Monthly paid revenue trend",
            points: cur.monthly.map((m) => ({
              month: m.month,
              value: m.paidCents,
              label: formatCents(m.paidCents, CURRENCY),
            })),
          }
        : null,
  };
  return { outstanding, revenue, card };
}

async function booksCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  previousRange: { start: Date; end: Date } | null,
): Promise<{ cash: KpiCardData; card: ModuleCardData }> {
  // listTransactions accepts dateFrom/dateTo (cap 2000) - fetch current + previous separately.
  const [curRows, prevRows] = await Promise.all([
    listTransactions(workspaceId, {
      dateFrom: currentRange.start ?? undefined,
      dateTo: currentRange.end,
      limit: 2000,
    }),
    previousRange
      ? listTransactions(workspaceId, {
          dateFrom: previousRange.start,
          dateTo: previousRange.end,
          limit: 2000,
        })
      : Promise.resolve([]),
  ]);
  const toInput = (rows: typeof curRows) =>
    rows.map((t) => ({
      type: t.type,
      amountCents: t.amountCents,
      date: t.date,
      category: t.category,
    }));
  const cur = summarizeTransactions(toInput(curRows));
  const prev = previousRange ? summarizeTransactions(toInput(prevRows)) : null;

  const cash: KpiCardData = {
    id: "cash",
    label: "Cash position",
    value: cur.netCents !== 0 || cur.count > 0 ? formatCents(cur.netCents, CURRENCY) : null,
    delta: prev ? percentDelta(cur.netCents, prev.netCents) : null,
    href: "/books",
    emptyLabel: "No transactions yet",
  };
  const card: ModuleCardData = {
    key: "books",
    href: "/books",
    name: MODULES.books.name,
    metrics: [
      { label: "Income", value: formatCents(cur.incomeCents, CURRENCY) },
      { label: "Expense", value: formatCents(cur.expenseCents, CURRENCY) },
      { label: "Net", value: formatCents(cur.netCents, CURRENCY) },
    ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: "Monthly net cash trend",
            points: cur.monthly.map((m) => ({
              month: m.month,
              value: m.netCents,
              label: formatCents(m.netCents, CURRENCY),
            })),
          }
        : null,
  };
  return { cash, card };
}

async function driveCard(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  booksEnabled: boolean,
): Promise<{ card: ModuleCardData }> {
  // Drive has no headline KPI in the 4-card row, so no previous-period fetch - current period
  // only (earnings + trips in parallel).
  const [earn, trips] = await Promise.all([
    listEarnings(workspaceId, {
      dateFrom: currentRange.start ?? undefined,
      dateTo: currentRange.end,
      limit: 2000,
    }),
    listTrips(workspaceId, {
      dateFrom: currentRange.start ?? undefined,
      dateTo: currentRange.end,
      limit: 2000,
    }),
  ]);
  const cur = summarizeDrive(
    earn.map((e) => ({ amountCents: e.amountCents, date: e.date, platform: e.platform })),
    trips.map((t) => ({ distanceMeters: t.distanceMeters, date: t.date, platform: t.platform })),
  );

  // When Books is installed it is the single source of truth for dollar earnings/expenses -
  // the mirrored gig income already appears in the Books card. So the Drive card shows only
  // operational (non-dollar) metrics: distance + trips, with a distance trend. Drive-only
  // workspaces (no Books) still see dollar earnings here, since there's no Books to defer to.
  const card: ModuleCardData = {
    key: "drive",
    href: "/drive",
    name: MODULES.drive.name,
    metrics: booksEnabled
      ? [
          { label: "Mileage", value: formatKm(cur.totalDistanceMeters) },
          { label: "Trips", value: String(cur.tripsCount) },
        ]
      : [
          { label: "Earnings", value: formatCents(cur.totalEarningsCents, CURRENCY) },
          { label: "Mileage", value: formatKm(cur.totalDistanceMeters) },
          { label: "Trips", value: String(cur.tripsCount) },
        ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: booksEnabled ? "Monthly distance trend" : "Monthly gig earnings trend",
            points: cur.monthly.map((m) =>
              booksEnabled
                ? { month: m.month, value: m.distanceMeters, label: formatKm(m.distanceMeters) }
                : {
                    month: m.month,
                    value: m.earningsCents,
                    label: formatCents(m.earningsCents, CURRENCY),
                  },
            ),
          }
        : null,
  };
  return { card };
}

async function quotesCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
): Promise<{ pending: KpiCardData; card: ModuleCardData }> {
  // listQuotes is capped at 200, no date-range filter - fetch once, bucket by date. The Pending
  // KPI is a snapshot (accepted-but-not-converted value), so no previous-period fetch.
  const rows = await listQuotes(workspaceId, { limit: 200 });
  const toInput = rows.map((r) => ({
    status: r.status,
    totalCents: r.totalCents,
    sentAt: r.sentAt,
    acceptedAt: r.acceptedAt,
    declinedAt: r.declinedAt,
    convertedAt: r.convertedAt,
    issueDate: r.issueDate,
  }));
  const cur = summarizeQuotes(toInput, currentRange);

  const pending: KpiCardData = {
    id: "pending-quotes",
    label: "Pending quotes",
    value: cur.acceptedValueCents > 0 ? formatCents(cur.acceptedValueCents, CURRENCY) : null,
    delta: null, // snapshot - accepted-but-not-converted value, no delta
    href: "/quotes",
    emptyLabel: "No accepted quotes pending",
  };
  const card: ModuleCardData = {
    key: "quotes",
    href: "/quotes",
    name: MODULES.quotes.name,
    metrics: [
      { label: "Pending", value: formatCents(cur.acceptedValueCents, CURRENCY) },
      { label: "Sent", value: String(cur.sentCount) },
      { label: "Accepted", value: String(cur.acceptedCount) },
    ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: "Monthly accepted-quote value trend",
            points: cur.monthly.map((m) => ({
              month: m.month,
              value: m.acceptedCents,
              label: formatCents(m.acceptedCents, CURRENCY),
            })),
          }
        : null,
  };
  return { pending, card };
}

// --- Loader -----------------------------------------------------------------

export async function loadDashboardPage(params?: { period?: Period }): Promise<DashboardData> {
  const ctx = await requireWorkspaceContext();
  const requested = params?.period;
  const period: Period = requested ? parsePeriod(requested) : DASHBOARD_DEFAULT_PERIOD;

  // Fetch the workspace (for its `fyStartMonth`) alongside the installed-module list, then
  // reanchor the "year"/"quarter" period windows to the workspace's financial year.
  const [workspace, installed] = await Promise.all([
    getWorkspace(ctx.workspaceId),
    getInstalledModules(ctx.workspaceId),
  ]);
  const fyStartMonth = workspace?.fyStartMonth ?? 7;
  const currentRange = periodRange(period, undefined, fyStartMonth);
  const previousRange = previousPeriodRange(period, undefined, fyStartMonth);
  const has = (k: ModuleKey) => installed.includes(k);

  // Fetch only installed modules; each runs its own parallel fetches internally. All four
  // run concurrently here alongside the activity feed.
  const [invoices, books, drive, quotes, activity] = await Promise.all([
    has("invoices") ? invoicesCards(ctx.workspaceId, currentRange, previousRange) : null,
    has("books") ? booksCards(ctx.workspaceId, currentRange, previousRange) : null,
    has("drive") ? driveCard(ctx.workspaceId, currentRange, has("books")) : null,
    has("quotes") ? quotesCards(ctx.workspaceId, currentRange) : null,
    listActivity(ctx.workspaceId, { limit: 5 }),
  ]);

  // Build the 4 headline KPI cards. A card whose module isn't installed shows an enable CTA.
  const enableCard = (id: string, label: string, enableLabel: string): KpiCardData => ({
    id,
    label,
    value: null,
    delta: null,
    href: "/settings/modules",
    emptyLabel: enableLabel,
  });

  const kpis: KpiCardData[] = [
    books ? books.cash : enableCard("cash", "Cash position", "Enable Books"),
    invoices
      ? invoices.outstanding
      : enableCard("outstanding", "Outstanding invoices", "Enable Invoices"),
    invoices ? invoices.revenue : enableCard("revenue", "Revenue this period", "Enable Invoices"),
    quotes ? quotes.pending : enableCard("pending-quotes", "Pending quotes", "Enable Quotes"),
  ];

  // Per-enabled-module summary cards (in the canonical MODULE_KEYS order).
  const moduleCards: ModuleCardData[] = [];
  if (invoices) moduleCards.push(invoices.card);
  if (books) moduleCards.push(books.card);
  if (drive) moduleCards.push(drive.card);
  if (quotes) moduleCards.push(quotes.card);

  return {
    period,
    installedModules: installed,
    kpis,
    moduleCards,
    activity,
    onboarding: installed.length === 0,
  };
}
