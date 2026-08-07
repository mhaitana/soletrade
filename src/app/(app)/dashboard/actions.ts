"use server";

import { requireWorkspaceContext } from "@/platform/context";
import { getWorkspace } from "@/platform/workspaces";
import { getInstalledModules } from "@/platform/module-installations";
import { formatCents } from "@/platform/billing/pricing";
import { formatKm } from "@/modules/drive/calc";
import { listActivity, type ActivityPage } from "@/platform/activity";
import { authorize } from "@/platform/permissions";
import { periodRange, previousPeriodRange, parsePeriod, type Period } from "@/shared/utils/periods";
import { percentDelta, type Delta } from "@/shared/utils/delta";
import type { SparklinePoint } from "@/shared/components/sparkline";
import { MODULES, type ModuleKey } from "@/shared/constants/modules";
import type { WorkspaceId } from "@/shared/types/ids";
import { listInvoices, summarizeInvoices } from "@/modules/invoices";
import { listTransactions, summarizeTransactions } from "@/modules/books";
import { listEarnings, listTrips, summarizeDrive } from "@/modules/drive";
import { listQuotes, summarizeQuotes } from "@/modules/quotes";
import { listExtractions } from "@/modules/books/receipt-extraction";
import { consolidateBusinessIncome, type PeriodIncome } from "./business-overview";

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
 * **KPI deltas** are computed for Books net and business-wide total income. Books is the
 * canonical income source when installed because it contains the Invoice/Drive mirrors; without
 * Books, paid invoices and Drive earnings are combined. Outstanding and Ready to invoice remain
 * current-state snapshots.
 */

const DASHBOARD_DEFAULT_PERIOD: Period = "month";
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

export interface AttentionItemData {
  id: string;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  tone: "danger" | "warning" | "info" | "neutral";
  icon: "invoice" | "quote" | "receipt" | "draft";
}

export interface DashboardData {
  period: Period;
  workspaceName: string;
  currency: string;
  installedModules: ModuleKey[];
  kpis: KpiCardData[];
  moduleCards: ModuleCardData[];
  attentionItems: AttentionItemData[];
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
  currency: string,
): Promise<{
  outstanding: KpiCardData;
  income: PeriodIncome;
  card: ModuleCardData;
  signals: { overdueCount: number; overdueCents: number; draftCount: number };
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
    value: cur.outstandingCents > 0 ? formatCents(cur.outstandingCents, currency) : null,
    delta: null, // snapshot - no delta
    href: "/invoices",
    emptyLabel: "No outstanding invoices",
  };
  const card: ModuleCardData = {
    key: "invoices",
    href: "/invoices",
    name: MODULES.invoices.name,
    metrics: [
      { label: "Outstanding", value: formatCents(cur.outstandingCents, currency) },
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
              label: formatCents(m.paidCents, currency),
            })),
          }
        : null,
  };
  return {
    outstanding,
    income: { currentCents: cur.paidCents, previousCents: prev?.paidCents ?? null },
    card,
    signals: {
      overdueCount: cur.overdueCount,
      overdueCents: rows.reduce(
        (total, invoice) => total + (invoice.status === "overdue" ? invoice.totalCents : 0),
        0,
      ),
      draftCount: cur.draftCount,
    },
  };
}

async function booksCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  previousRange: { start: Date; end: Date } | null,
  currency: string,
): Promise<{ cash: KpiCardData; income: PeriodIncome; card: ModuleCardData }> {
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
      gstCents: t.gstCents,
    }));
  const cur = summarizeTransactions(toInput(curRows));
  const prev = previousRange ? summarizeTransactions(toInput(prevRows)) : null;

  const cash: KpiCardData = {
    id: "cash",
    label: "Net cash flow",
    value: cur.netCents !== 0 || cur.count > 0 ? formatCents(cur.netCents, currency) : null,
    delta: prev ? percentDelta(cur.netCents, prev.netCents) : null,
    href: "/books",
    emptyLabel: "No transactions yet",
  };
  const card: ModuleCardData = {
    key: "books",
    href: "/books",
    name: MODULES.books.name,
    metrics: [
      { label: "Income", value: formatCents(cur.incomeCents, currency) },
      { label: "Expense", value: formatCents(cur.expenseCents, currency) },
      { label: "Net", value: formatCents(cur.netCents, currency) },
    ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: "Monthly net cash trend",
            points: cur.monthly.map((m) => ({
              month: m.month,
              value: m.netCents,
              label: formatCents(m.netCents, currency),
            })),
          }
        : null,
  };
  return {
    cash,
    income: { currentCents: cur.incomeCents, previousCents: prev?.incomeCents ?? null },
    card,
  };
}

async function driveCard(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  previousRange: { start: Date; end: Date } | null,
  currency: string,
): Promise<{ income: PeriodIncome; card: ModuleCardData }> {
  const [earn, trips, previousEarnings] = await Promise.all([
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
    previousRange
      ? listEarnings(workspaceId, {
          dateFrom: previousRange.start,
          dateTo: previousRange.end,
          limit: 2000,
        })
      : Promise.resolve([]),
  ]);
  const cur = summarizeDrive(
    earn.map((e) => ({ amountCents: e.amountCents, date: e.date, platform: e.platform })),
    trips.map((t) => ({ distanceMeters: t.distanceMeters, date: t.date, platform: t.platform })),
  );

  const card: ModuleCardData = {
    key: "drive",
    href: "/drive",
    name: MODULES.drive.name,
    metrics: [
      { label: "Earnings", value: formatCents(cur.totalEarningsCents, currency) },
      { label: "Mileage", value: formatKm(cur.totalDistanceMeters) },
      { label: "Trips", value: String(cur.tripsCount) },
    ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: "Monthly gig earnings trend",
            points: cur.monthly.map((m) => ({
              month: m.month,
              value: m.earningsCents,
              label: formatCents(m.earningsCents, currency),
            })),
          }
        : null,
  };
  return {
    income: {
      currentCents: cur.totalEarningsCents,
      previousCents: previousRange
        ? previousEarnings.reduce((sum, earning) => sum + earning.amountCents, 0)
        : null,
    },
    card,
  };
}

async function quotesCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  currency: string,
): Promise<{
  pending: KpiCardData;
  card: ModuleCardData;
  signals: { acceptedCount: number; acceptedValueCents: number };
}> {
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
  const readyCount = rows.filter((quote) => quote.status === "accepted").length;

  const pending: KpiCardData = {
    id: "pending-quotes",
    label: "Ready to invoice",
    value: cur.acceptedValueCents > 0 ? formatCents(cur.acceptedValueCents, currency) : null,
    delta: null, // snapshot - accepted-but-not-converted value, no delta
    href: "/quotes",
    emptyLabel: "No accepted quotes waiting",
  };
  const card: ModuleCardData = {
    key: "quotes",
    href: "/quotes",
    name: MODULES.quotes.name,
    metrics: [
      { label: "Ready", value: formatCents(cur.acceptedValueCents, currency) },
      { label: "Waiting", value: String(readyCount) },
      { label: "Sent", value: String(cur.sentCount) },
    ],
    sparkline:
      cur.monthly.length > 0
        ? {
            ariaLabel: "Monthly accepted-quote value trend",
            points: cur.monthly.map((m) => ({
              month: m.month,
              value: m.acceptedCents,
              label: formatCents(m.acceptedCents, currency),
            })),
          }
        : null,
  };
  return {
    pending,
    card,
    signals: {
      acceptedCount: readyCount,
      acceptedValueCents: cur.acceptedValueCents,
    },
  };
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
  const currency = workspace?.defaultCurrency ?? "AUD";
  const currentRange = periodRange(period, undefined, fyStartMonth);
  const previousRange = previousPeriodRange(period, undefined, fyStartMonth);
  const has = (k: ModuleKey) => installed.includes(k);

  // Fetch only installed modules; each runs its own parallel fetches internally. All four
  // run concurrently here alongside the activity feed.
  const [invoices, books, drive, quotes, pendingReceipts, activity] = await Promise.all([
    has("invoices") ? invoicesCards(ctx.workspaceId, currentRange, previousRange, currency) : null,
    has("books") ? booksCards(ctx.workspaceId, currentRange, previousRange, currency) : null,
    has("drive") ? driveCard(ctx.workspaceId, currentRange, previousRange, currency) : null,
    has("quotes") ? quotesCards(ctx.workspaceId, currentRange, currency) : null,
    has("books") && authorize(ctx.role, "manage:books").ok
      ? listExtractions(ctx.workspaceId, { status: "pending", limit: 100 })
      : Promise.resolve([]),
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

  const totalIncome = consolidateBusinessIncome({
    books: books?.income,
    invoices: invoices?.income,
    drive: drive?.income,
  });
  const incomeHref = books
    ? "/books"
    : invoices
      ? "/invoices"
      : drive
        ? "/drive"
        : "/settings/modules";
  const incomeKpi: KpiCardData = totalIncome.source
    ? {
        id: "income",
        label: "Total income",
        value:
          totalIncome.currentCents > 0 ? formatCents(totalIncome.currentCents, currency) : null,
        delta:
          totalIncome.previousCents !== null
            ? percentDelta(totalIncome.currentCents, totalIncome.previousCents)
            : null,
        href: incomeHref,
        emptyLabel: "No income recorded yet",
      }
    : enableCard("income", "Total income", "Enable Books, Invoices, or Drive");

  const kpis: KpiCardData[] = [
    books ? books.cash : enableCard("cash", "Net cash flow", "Enable Books"),
    invoices
      ? invoices.outstanding
      : enableCard("outstanding", "Outstanding invoices", "Enable Invoices"),
    incomeKpi,
    quotes ? quotes.pending : enableCard("pending-quotes", "Ready to invoice", "Enable Quotes"),
  ];

  // Per-enabled-module summary cards (in the canonical MODULE_KEYS order).
  const moduleCards: ModuleCardData[] = [];
  if (invoices) moduleCards.push(invoices.card);
  if (books) moduleCards.push(books.card);
  if (drive) moduleCards.push(drive.card);
  if (quotes) moduleCards.push(quotes.card);

  const attentionItems: AttentionItemData[] = [];
  if (invoices?.signals.overdueCount) {
    attentionItems.push({
      id: "overdue-invoices",
      title: `${invoices.signals.overdueCount} overdue ${invoices.signals.overdueCount === 1 ? "invoice" : "invoices"}`,
      detail: `${formatCents(invoices.signals.overdueCents, currency)} is past due and may need a follow-up.`,
      href: "/invoices?status=overdue",
      actionLabel: "Review overdue",
      tone: "danger",
      icon: "invoice",
    });
  }
  if (quotes?.signals.acceptedCount) {
    attentionItems.push({
      id: "accepted-quotes",
      title: `${quotes.signals.acceptedCount} accepted ${quotes.signals.acceptedCount === 1 ? "quote is" : "quotes are"} ready to invoice`,
      detail: `${formatCents(quotes.signals.acceptedValueCents, currency)} of approved work is waiting to be converted.`,
      href: "/quotes?status=accepted",
      actionLabel: "Create invoices",
      tone: "info",
      icon: "quote",
    });
  }
  if (pendingReceipts.length > 0) {
    attentionItems.push({
      id: "pending-receipts",
      title: `${pendingReceipts.length} ${pendingReceipts.length === 1 ? "receipt needs" : "receipts need"} review`,
      detail: "Confirm the extracted details before adding them to your books.",
      href: "/books/receipts?status=pending",
      actionLabel: "Review receipts",
      tone: "warning",
      icon: "receipt",
    });
  }
  if (invoices?.signals.draftCount) {
    attentionItems.push({
      id: "draft-invoices",
      title: `${invoices.signals.draftCount} draft ${invoices.signals.draftCount === 1 ? "invoice" : "invoices"}`,
      detail: "Finish or remove drafts so your invoice list reflects active work.",
      href: "/invoices?status=draft",
      actionLabel: "Finish drafts",
      tone: "neutral",
      icon: "draft",
    });
  }

  return {
    period,
    workspaceName: workspace?.name ?? "Your business",
    currency,
    installedModules: installed,
    kpis,
    moduleCards,
    attentionItems,
    activity,
    onboarding: installed.length === 0,
  };
}
