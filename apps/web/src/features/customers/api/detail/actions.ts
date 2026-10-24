"use server";

import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorize } from "@/lib/domain/permissions/index";
import { getCustomer } from "@/server/foundation/customers/index";
import type { CustomerRow } from "@/lib/domain/customers/types";
import { listActivity } from "@/server/foundation/activity/index";
import type { ActivityRow } from "@/lib/domain/activity/types";
import { listInvoices } from "@/server/domains/invoices/index";
import type { InvoiceRow } from "@/lib/domain/invoices/types";
import { listQuotes } from "@/server/domains/quotes/index";
import type { QuoteRow } from "@/lib/domain/quotes/types";
import { listTransactions } from "@/server/domains/books/index";
import { formatCents } from "@/lib/domain/billing/pricing";
import { branded } from "@/types/ids";
import type { TimelineEntry, TimelineTone } from "@/types/timeline";

/**
 * Customer timeline loader (Wave 3 - pragmatic customer 360). A composition root in the app
 * layer (mirrors `dashboard/actions.ts`): fetches the customer (IDOR-safe) + fans out to the
 * invoices/quotes/transactions list functions' existing `{ customerId }` filters + the activity
 * `listActivity({ entityType: "customer", entityId })` filter, then merges invoices/quotes/
 * transactions into a single chronological timeline. Activity is kept separate (rendered in its
 * own panel below).
 *
 * This is a 360 view, NOT a full event history: it shows rows that reference the customer + the
 * customer-lifecycle activity events. It does not show, e.g., `InvoiceSent` for this customer
 * (that event has `entityType: "invoice"`, so the `entityType:"customer"` filter won't return it).
 *
 * The timeline is visible to any member (`manage:customer` gates only the Edit button). The
 * session-resolved `workspaceId` is used everywhere - the client-provided `customerId` is branded
 * + the underlying list functions are workspace-scoped (IDOR-safe at the source).
 */

export type CustomerTimelinePage =
  | {
      found: true;
      customer: CustomerRow;
      canManage: boolean;
      timeline: TimelineEntry[];
      activity: ActivityRow[];
    }
  | { found: false };

function invoiceTone(status: InvoiceRow["status"]): TimelineTone {
  switch (status) {
    case "paid":
      return "positive";
    case "overdue":
      return "warning";
    case "void":
      return "negative";
    default:
      return "neutral";
  }
}

function quoteTone(status: QuoteRow["status"]): TimelineTone {
  switch (status) {
    case "accepted":
    case "converted":
      return "positive";
    case "declined":
    case "expired":
      return "negative";
    default:
      return "neutral";
  }
}

/** Load a customer's 360 timeline. Returns `found: false` when the customer doesn't exist or
 *  belongs to another workspace (IDOR-safe via `getCustomer`). */
export async function loadCustomerTimeline(customerId: string): Promise<CustomerTimelinePage> {
  const ctx = await requireWorkspaceContext();
  const id = branded<"CustomerId">(customerId);
  const customer = await getCustomer(ctx.workspaceId, id);
  if (!customer) return { found: false };
  const canManage = authorize(ctx.role, "manage:customer").ok;

  const [invoices, quotes, transactions, activityPage] = await Promise.all([
    listInvoices(ctx.workspaceId, { customerId: id, limit: 200 }),
    listQuotes(ctx.workspaceId, { customerId: id, limit: 200 }),
    listTransactions(ctx.workspaceId, { customerId: id, limit: 500 }),
    listActivity(ctx.workspaceId, { entityType: "customer", entityId: id, limit: 100 }),
  ]);

  const timeline: TimelineEntry[] = [
    ...invoices.map((i) => ({
      kind: "invoice" as const,
      date: i.issueDate,
      id: i.id,
      label: i.number,
      sublabel: `${formatCents(i.totalCents, i.currency)} · ${i.status}`,
      href: `/invoices/${i.id}`,
      tone: invoiceTone(i.status),
    })),
    ...quotes.map((q) => ({
      kind: "quote" as const,
      date: q.issueDate,
      id: q.id,
      label: q.number,
      sublabel: `${formatCents(q.totalCents, q.currency)} · ${q.status}`,
      href: `/quotes/${q.id}`,
      tone: quoteTone(q.status),
    })),
    ...transactions.map((t) => ({
      kind: "transaction" as const,
      date: t.date,
      id: t.id,
      label: t.description,
      sublabel: `${t.type === "income" ? "+" : "−"}${formatCents(t.amountCents, t.currency)}`,
      // Books has no per-transaction detail route - deep-link to the books list for now.
      href: "/books",
      tone: (t.type === "income" ? "positive" : "negative") as TimelineTone,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return { found: true, customer, canManage, timeline, activity: activityPage.items };
}
