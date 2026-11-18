"use server";

import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { formatCents } from "@/lib/domain/billing/pricing";
import { formatKm } from "@/lib/domain/drive/calc";
import { listActivity } from "@/server/foundation/activity/index";
import type { ActivityPage } from "@/lib/domain/activity/types";
import { authorize } from "@/lib/domain/permissions/index";
import { periodRange, previousPeriodRange, parsePeriod, type Period } from "@/utils/periods";
import { percentDelta, type Delta } from "@/utils/delta";
import type { SparklinePoint } from "@/components/sparkline";
import { MODULES, type ModuleKey } from "@/config/modules";
import type { WorkspaceId } from "@/types/ids";
import { getInvoiceDashboardSummary, countNonDraftInvoices } from "@/server/domains/invoices/index";
import { getBookSummary } from "@/server/domains/books/index";
import { getDriveSummary } from "@/server/domains/drive/index";
import { getQuoteDashboardSummary, countNonDraftQuotes } from "@/server/domains/quotes/index";
import { countCustomers } from "@/server/foundation/customers/index";
import {
  buildSetupChecklist,
  type SetupChecklist,
} from "@/features/dashboard/utils/setup-checklist";
import { buildAttentionItems } from "@/features/dashboard/utils/attention-items";
import { collectInsightFacts } from "@/server/application/insights/facts";
import { composeBriefing } from "@/lib/domain/insights/briefing";
import { formatAsOf } from "@/lib/domain/insights/local-date";
import { consolidateBusinessIncome, type PeriodIncome } from "@soletrade/contracts/business-income";

/**
 * Cross-module dashboard loader (Phase 9). This is the **composition root** - it MAY import all
 * four module services (the services stay decoupled; no module→module import). It fans out to
 * each installed module's compact database aggregate in parallel for the current AND previous
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
 *
 * The briefing card and the "Needs attention" list are both built from one read of the
 * member's insight facts (`collectInsightFacts`), the same facts the briefing digest sends.
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

export interface BriefingCardData {
  /** One or two sentences built from the member's facts; says so when nothing is waiting. */
  headline: string;
  /** When the facts were read: an ISO instant, and the same moment in workspace time. */
  asOf: string;
  asOfLabel: string;
  /** Lists the headline's facts can be dealt with in; empty when nothing is waiting. */
  links: { id: string; label: string; href: string }[];
}

export interface DashboardData {
  period: Period;
  workspaceName: string;
  currency: string;
  installedModules: ModuleKey[];
  kpis: KpiCardData[];
  moduleCards: ModuleCardData[];
  /**
   * Null while no module is installed (there is nothing a briefing could cover yet) and
   * when the facts could not be read.
   */
  briefing: BriefingCardData | null;
  attentionItems: AttentionItemData[];
  /**
   * The facts behind the briefing and "Needs attention" could not be read, so the page
   * must not claim that nothing is waiting.
   */
  insightsUnavailable: boolean;
  activity: ActivityPage;
  /** Getting-started checklist built from real data; null when complete or not applicable to the viewer's role. */
  setup: SetupChecklist | null;
  /** True when zero modules are installed - the page renders the onboarding stub instead. */
  onboarding: boolean;
}

// --- Per-module fetch + aggregate -------------------------------------------
// Each helper takes the session-resolved workspaceId (never a client value) and the current +
// previous ranges, requests compact aggregates, and shapes the card data. They run concurrently
// via Promise.all in the loader.

async function invoicesCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  previousRange: { start: Date; end: Date } | null,
  currency: string,
): Promise<{ outstanding: KpiCardData; income: PeriodIncome; card: ModuleCardData }> {
  const cur = await getInvoiceDashboardSummary(workspaceId, currentRange, previousRange);

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
    income: { currentCents: cur.paidCents, previousCents: cur.previousPaidCents },
    card,
  };
}

async function booksCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  previousRange: { start: Date; end: Date } | null,
  currency: string,
): Promise<{ cash: KpiCardData; income: PeriodIncome; card: ModuleCardData }> {
  const [cur, prev] = await Promise.all([
    getBookSummary(workspaceId, {
      dateFrom: currentRange.start ?? undefined,
      dateTo: currentRange.end,
    }),
    previousRange
      ? getBookSummary(workspaceId, {
          dateFrom: previousRange.start,
          dateTo: previousRange.end,
        })
      : Promise.resolve(null),
  ]);

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
  const [cur, prev] = await Promise.all([
    getDriveSummary(workspaceId, {
      dateFrom: currentRange.start ?? undefined,
      dateTo: currentRange.end,
    }),
    previousRange
      ? getDriveSummary(workspaceId, {
          dateFrom: previousRange.start,
          dateTo: previousRange.end,
        })
      : Promise.resolve(null),
  ]);

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
      previousCents: prev?.totalEarningsCents ?? null,
    },
    card,
  };
}

async function quotesCards(
  workspaceId: WorkspaceId,
  currentRange: { start: Date | null; end: Date },
  currency: string,
): Promise<{ pending: KpiCardData; card: ModuleCardData }> {
  const cur = await getQuoteDashboardSummary(workspaceId, currentRange);

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
      { label: "Waiting", value: String(cur.readyCount) },
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
  const currency = workspace?.defaultCurrency ?? "AUD";
  const currentRange = periodRange(period, undefined, fyStartMonth);
  const previousRange = previousPeriodRange(period, undefined, fyStartMonth);
  const has = (k: ModuleKey) => installed.includes(k);

  // Fetch only installed modules; each runs its own parallel fetches internally. All four
  // run concurrently here alongside the activity feed.
  // Setup checklist: only for viewers who can act on it (owners/admins, or anyone while no module
  // is installed yet). Cheap head counts, each gated by the same module + permission checks.
  const wantsSetup = installed.length === 0 || authorize(ctx.role, "manage:module").ok;
  const [
    invoices,
    books,
    drive,
    quotes,
    facts,
    activity,
    customerCount,
    sentInvoiceCount,
    sentQuoteCount,
  ] = await Promise.all([
    has("invoices") ? invoicesCards(ctx.workspaceId, currentRange, previousRange, currency) : null,
    has("books") ? booksCards(ctx.workspaceId, currentRange, previousRange, currency) : null,
    has("drive") ? driveCard(ctx.workspaceId, currentRange, previousRange, currency) : null,
    has("quotes") ? quotesCards(ctx.workspaceId, currentRange, currency) : null,
    // What this member can be told needs attention, limited by installed modules and role.
    // The rest of the dashboard does not depend on them, so a failure here (for example
    // the web app deployed before its migration) costs these two sections, not the page.
    collectInsightFacts(
      { workspaceId: ctx.workspaceId, role: ctx.role },
      { workspace, installedModules: installed },
    ).catch((error: unknown) => {
      console.error("[dashboard] insight facts unavailable", error);
      return null;
    }),
    listActivity(ctx.workspaceId, { limit: 5 }),
    wantsSetup && authorize(ctx.role, "view:customer").ok
      ? countCustomers(ctx.workspaceId)
      : Promise.resolve(0),
    wantsSetup && has("invoices") && authorize(ctx.role, "view:invoice").ok
      ? countNonDraftInvoices(ctx.workspaceId)
      : Promise.resolve(0),
    wantsSetup && has("quotes") && authorize(ctx.role, "view:quote").ok
      ? countNonDraftQuotes(ctx.workspaceId)
      : Promise.resolve(0),
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

  // The briefing card and the "Needs attention" list read the same facts, so they agree.
  const attentionItems = facts ? buildAttentionItems(facts) : [];
  const composed = facts ? composeBriefing(facts) : null;
  const briefing: BriefingCardData | null =
    facts && composed
      ? {
          headline: composed.headline,
          asOf: facts.asOf,
          asOfLabel: formatAsOf(new Date(facts.asOf), facts.timezone),
          links: composed.items.map((item) => ({
            id: item.id,
            label: item.linkLabel,
            href: item.href,
          })),
        }
      : null;

  return {
    period,
    workspaceName: workspace?.name ?? "Your business",
    currency,
    installedModules: installed,
    kpis,
    moduleCards,
    briefing: installed.length > 0 ? briefing : null,
    attentionItems,
    insightsUnavailable: facts === null,
    activity,
    setup: wantsSetup
      ? buildSetupChecklist({
          installedModules: installed,
          customerCount,
          sentDocumentCount: sentInvoiceCount + sentQuoteCount,
        })
      : null,
    onboarding: installed.length === 0,
  };
}
