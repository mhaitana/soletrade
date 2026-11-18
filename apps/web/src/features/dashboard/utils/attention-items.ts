import { formatCents } from "@/lib/domain/billing/pricing";
import type { InsightFacts } from "@/lib/domain/insights/facts";
import type { AttentionItemData } from "@/features/dashboard/api/actions";

/**
 * The dashboard's "Needs attention" list, built from the same insight facts as the briefing
 * card and the digest so the three cannot disagree. Pure. The list keeps its own wording
 * and its four entries (overdue invoices, accepted quotes, receipts to review, draft
 * invoices, in that order); the facts it does not show, such as invoices due soon, appear
 * in the briefing above it.
 */
export function buildAttentionItems(facts: InsightFacts): AttentionItemData[] {
  const items: AttentionItemData[] = [];
  const overdue = facts.overdueInvoices;
  const accepted = facts.acceptedQuotes;
  const receipts = facts.receiptsToReview?.count ?? 0;
  const drafts = facts.draftInvoices?.count ?? 0;

  if (overdue && overdue.count > 0) {
    items.push({
      id: "overdue-invoices",
      title: `${overdue.count} overdue ${overdue.count === 1 ? "invoice" : "invoices"}`,
      detail: `${formatCents(overdue.totalCents, facts.currency)} is past due and may need a follow-up.`,
      href: "/invoices?status=overdue",
      actionLabel: "Review overdue",
      tone: "danger",
      icon: "invoice",
    });
  }
  if (accepted && accepted.count > 0) {
    items.push({
      id: "accepted-quotes",
      title: `${accepted.count} accepted ${accepted.count === 1 ? "quote is" : "quotes are"} ready to invoice`,
      detail: `${formatCents(accepted.totalCents, facts.currency)} of approved work is waiting to be converted.`,
      href: "/quotes?status=accepted",
      actionLabel: "Create invoices",
      tone: "info",
      icon: "quote",
    });
  }
  if (receipts > 0) {
    items.push({
      id: "pending-receipts",
      title: `${receipts} ${receipts === 1 ? "receipt needs" : "receipts need"} review`,
      detail: "Confirm the extracted details before adding them to your books.",
      href: "/books/receipts?status=pending",
      actionLabel: "Review receipts",
      tone: "warning",
      icon: "receipt",
    });
  }
  if (drafts > 0) {
    items.push({
      id: "draft-invoices",
      title: `${drafts} draft ${drafts === 1 ? "invoice" : "invoices"}`,
      detail: "Finish or remove drafts so your invoice list reflects active work.",
      href: "/invoices?status=draft",
      actionLabel: "Finish drafts",
      tone: "neutral",
      icon: "draft",
    });
  }
  return items;
}
