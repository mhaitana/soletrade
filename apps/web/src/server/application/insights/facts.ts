import "server-only";
import { z } from "zod";
import { getDataClient } from "@/server/infrastructure/db/client";
import { rpc } from "@/server/infrastructure/db/helpers";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { getBookSummary } from "@/server/domains/books/index";
import { countExtractions } from "@/server/domains/books/receipt-extraction";
import { listTaxPeriods, quarterRange } from "@/server/domains/books/tax";
import type { ModuleKey, WorkspaceRole } from "@/lib/domain/database-enums";
import {
  INSIGHT_WINDOW_DAYS,
  insightScope,
  type InsightFacts,
  type InsightGstFact,
  type InsightScope,
} from "@/lib/domain/insights/facts";
import { localDate, quarterJustEnded } from "@/lib/domain/insights/local-date";
import type { WorkspaceId } from "@/types/ids";

/**
 * Insight facts for one member of one workspace: what is overdue, due soon, waiting or
 * unfinished, limited to the areas that member may see. The dashboard's "Needs attention"
 * list, the briefing card and the digest all read these, so they cannot disagree.
 *
 * Callers pass the workspace id and role from the authenticated context (or, for the
 * digest job, from the member's own membership row); nothing here trusts a client value.
 * Every figure comes from the database. There is no model call.
 *
 * "Unusual spend" is deliberately not a fact. Small workspaces have too few transactions
 * for a threshold that separates a one-off purchase from a mistake, and a wrong alarm
 * about money costs more trust than the hint is worth.
 */

/** The parts of a workspace the facts need; the dashboard passes the row it already has. */
type InsightWorkspace = {
  timezone?: string | null;
  defaultCurrency?: string | null;
  fyStartMonth?: number | null;
};

export interface InsightMember {
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
}

export interface InsightOptions {
  /** The moment to report on. Tests pass a fixed time. */
  now?: Date;
  /** Already-loaded workspace and modules, so a caller that has them does not read twice. */
  workspace?: InsightWorkspace | null;
  installedModules?: readonly ModuleKey[];
}

const documentFactsSchema = z.object({
  invoices: z
    .object({
      overdueCount: z.number(),
      overdueCents: z.number(),
      dueSoonCount: z.number(),
      dueSoonCents: z.number(),
      draftCount: z.number(),
    })
    .nullable(),
  quotes: z
    .object({
      acceptedCount: z.number(),
      acceptedCents: z.number(),
      expiringCount: z.number(),
      expiringCents: z.number(),
    })
    .nullable(),
});

/** Invoice and quote counts and totals, as one database aggregate. */
async function readDocumentFacts(workspaceId: WorkspaceId, today: string, scope: InsightScope) {
  const { data, error } = await rpc(getDataClient(), "get_insight_facts", {
    p_workspace_id: workspaceId,
    p_today: today,
    p_include_invoices: scope.invoices,
    p_include_quotes: scope.quotes,
    p_days: INSIGHT_WINDOW_DAYS,
  });
  if (error) throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  return documentFactsSchema.parse(data);
}

/**
 * GST for the quarter that ended last month, if it has GST recorded and has not been
 * marked as lodged. The figures are the ones the Tax page's Lodge button would snapshot.
 * The existing GST code knows quarters and lodgement, not statutory due dates, so this
 * says "not lodged" rather than "due on a date". Outside the month after a quarter ends
 * it reads nothing.
 */
async function readGstToLodge(
  workspaceId: WorkspaceId,
  today: string,
  fyStartMonth: number,
): Promise<InsightGstFact | null> {
  const quarter = quarterJustEnded(today, fyStartMonth);
  if (!quarter) return null;
  const { start, end } = quarterRange(quarter.fiscalYear, quarter.quarter, fyStartMonth);
  const summary = await getBookSummary(workspaceId, { dateFrom: start, dateTo: end });
  // A quarter with no GST recorded has nothing to lodge; skip the lodgement lookup.
  if (!summary.gstCollectedCents && !summary.gstPaidCents) return null;
  const periods = await listTaxPeriods(workspaceId);
  const lodged = periods.some(
    (period) => period.periodLabel === quarter.label && period.lodgedAt !== null,
  );
  if (lodged) return null;
  return {
    periodLabel: quarter.label,
    netGstCents: summary.gstCollectedCents - summary.gstPaidCents,
  };
}

export async function collectInsightFacts(
  member: InsightMember,
  options: InsightOptions = {},
): Promise<InsightFacts> {
  const now = options.now ?? new Date();
  const [workspace, installedModules] = await Promise.all([
    options.workspace !== undefined ? options.workspace : getWorkspace(member.workspaceId),
    options.installedModules ?? getInstalledModules(member.workspaceId),
  ]);
  const scope = insightScope(member.role, installedModules);
  const { date: today, timezone } = localDate(now, workspace?.timezone);

  const [documents, receiptCount, gstToLodge] = await Promise.all([
    scope.invoices || scope.quotes ? readDocumentFacts(member.workspaceId, today, scope) : null,
    scope.receipts ? countExtractions(member.workspaceId, { status: "pending" }) : null,
    scope.gst ? readGstToLodge(member.workspaceId, today, workspace?.fyStartMonth ?? 7) : null,
  ]);
  // The function already leaves out a section it was not asked for; checking the scope
  // again here means a section can never reach a member who may not see it.
  const invoices = scope.invoices ? (documents?.invoices ?? null) : null;
  const quotes = scope.quotes ? (documents?.quotes ?? null) : null;

  return {
    asOf: now.toISOString(),
    today,
    timezone,
    currency: workspace?.defaultCurrency ?? "AUD",
    overdueInvoices: invoices && {
      count: invoices.overdueCount,
      totalCents: invoices.overdueCents,
    },
    invoicesDueSoon: invoices && {
      count: invoices.dueSoonCount,
      totalCents: invoices.dueSoonCents,
    },
    draftInvoices: invoices && { count: invoices.draftCount },
    acceptedQuotes: quotes && { count: quotes.acceptedCount, totalCents: quotes.acceptedCents },
    quotesExpiringSoon: quotes && {
      count: quotes.expiringCount,
      totalCents: quotes.expiringCents,
    },
    receiptsToReview: receiptCount === null ? null : { count: receiptCount },
    gstToLodge,
  };
}
