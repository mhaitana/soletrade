import type { ModuleKey, WorkspaceRole } from "@/lib/domain/database-enums";
import { can } from "@/lib/domain/permissions/index";

/**
 * Insight facts: the counts and totals behind the dashboard's "Needs attention" list, the
 * briefing card and the briefing digest. They are read from the database for one member of
 * one workspace; wording is built from them in `briefing.ts`. No model is involved at any
 * point, so a number shown to a person is always a number the database returned.
 */

/** "Due soon" and "expiring soon" look this many days past today. */
export const INSIGHT_WINDOW_DAYS = 7;

/** A count of documents and the sum of their totals, in cents. */
export interface InsightMoneyFact {
  count: number;
  totalCents: number;
}

export interface InsightCountFact {
  count: number;
}

/** GST for a finished quarter that has not been marked as lodged. */
export interface InsightGstFact {
  /** The quarter as the Tax page labels it, e.g. "2026-Q1". */
  periodLabel: string;
  /** GST collected minus GST paid: positive is owed, negative is a refund. */
  netGstCents: number;
}

/**
 * What one member can be told about one workspace right now. A section is `null` when the
 * member may not see that area (module not installed, or a role without access), which is
 * different from a zero count.
 */
export interface InsightFacts {
  /** When the facts were read, as an ISO 8601 instant. */
  asOf: string;
  /** The workspace's local date when they were read, `YYYY-MM-DD`. */
  today: string;
  /** The timezone `today` was worked out in (UTC when the workspace's is unknown). */
  timezone: string;
  /** The workspace's default currency; totals are formatted in it, as on the dashboard. */
  currency: string;
  /** Invoices whose status is overdue. */
  overdueInvoices: InsightMoneyFact | null;
  /** Sent or viewed invoices due today or in the next `INSIGHT_WINDOW_DAYS` days. */
  invoicesDueSoon: InsightMoneyFact | null;
  draftInvoices: InsightCountFact | null;
  /** Accepted quotes that have not been converted to an invoice. */
  acceptedQuotes: InsightMoneyFact | null;
  /** Sent or viewed quotes valid until today or a day in the next `INSIGHT_WINDOW_DAYS`. */
  quotesExpiringSoon: InsightMoneyFact | null;
  /** Receipts waiting in the review queue. */
  receiptsToReview: InsightCountFact | null;
  /** Set only in the month after a quarter with GST recorded ends, until it is lodged. */
  gstToLodge: InsightGstFact | null;
}

/** Which areas a member's facts may cover. */
export interface InsightScope {
  invoices: boolean;
  quotes: boolean;
  receipts: boolean;
  gst: boolean;
}

/**
 * The areas a role may be told about, given the workspace's installed modules. Invoices and
 * quotes need the module and permission to view it. The receipt queue needs permission to
 * manage Books, because reviewing a receipt writes to the books; this is the rule the
 * dashboard already applied. GST needs permission to view Books.
 */
export function insightScope(
  role: WorkspaceRole,
  installedModules: readonly ModuleKey[],
): InsightScope {
  const installed = (key: ModuleKey) => installedModules.includes(key);
  return {
    invoices: installed("invoices") && can(role, "view:invoice"),
    quotes: installed("quotes") && can(role, "view:quote"),
    receipts: installed("books") && can(role, "manage:books"),
    gst: installed("books") && can(role, "view:books"),
  };
}
