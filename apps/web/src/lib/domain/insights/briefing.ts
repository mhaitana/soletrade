import { formatCents } from "@/lib/domain/billing/pricing";
import { INSIGHT_WINDOW_DAYS, type InsightFacts } from "@/lib/domain/insights/facts";

/**
 * Briefing wording, built from insight facts by fixed rules. The dashboard card, the in-app
 * notification and the digest email all use this, so the same facts always read the same
 * way and every figure in a sentence is one of the facts passed in.
 */

export type BriefingItemId =
  | "overdue-invoices"
  | "invoices-due-soon"
  | "accepted-quotes"
  | "quotes-expiring-soon"
  | "pending-receipts"
  | "draft-invoices"
  | "gst-to-lodge";

/** One fact worth telling the member about, with where to act on it. */
export interface BriefingItem {
  id: BriefingItemId;
  /** The fact as a full statement, without a closing full stop. */
  text: string;
  /** The same fact as a short phrase for the headline. */
  phrase: string;
  /** App path of the list or page where the member can act on it. */
  href: string;
  linkLabel: string;
}

export interface Briefing {
  /** One or two sentences; says so when there is nothing to report. */
  headline: string;
  items: BriefingItem[];
  /** True when no fact needs attention. Nothing is sent for an empty briefing. */
  empty: boolean;
}

export const NOTHING_TO_REPORT = "Nothing needs your attention right now.";

const WINDOW = `in the next ${INSIGHT_WINDOW_DAYS} days`;

/** "1 invoice" / "3 invoices". */
function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** "a", "a and b", "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function gstAmount(netGstCents: number, money: (cents: number) => string): string | null {
  if (netGstCents > 0) return `${money(netGstCents)} owed`;
  if (netGstCents < 0) return `${money(-netGstCents)} refund due`;
  return null;
}

/**
 * Build the briefing for one set of facts: the items that need attention, most urgent
 * first, and the headline. Zero counts and sections the member may not see produce no
 * item. `money` formats cents; it defaults to the app's own format in the workspace
 * currency.
 *
 * The headline is at most two sentences. The first is about invoices that are overdue or
 * about to fall due, because that is money owed to the business; the second lists whatever
 * else is waiting. With no items it says there is nothing to report.
 */
export function composeBriefing(
  facts: InsightFacts,
  money: (cents: number) => string = (cents) => formatCents(cents, facts.currency),
): Briefing {
  const items: BriefingItem[] = [];
  const overdue = facts.overdueInvoices;
  const dueSoon = facts.invoicesDueSoon;
  let overduePhrase: string | null = null;
  let invoiceSentence: string | null = null;

  if (overdue && overdue.count > 0) {
    const subject = `${counted(overdue.count, "invoice")} ${overdue.count === 1 ? "is" : "are"} overdue`;
    const text = `${subject}, totalling ${money(overdue.totalCents)}`;
    overduePhrase = `${subject} (${money(overdue.totalCents)})`;
    invoiceSentence = `${text}.`;
    items.push({
      id: "overdue-invoices",
      text,
      phrase: overduePhrase,
      href: "/invoices?status=overdue",
      linkLabel: "Review overdue",
    });
  }
  if (dueSoon && dueSoon.count > 0) {
    const verb = dueSoon.count === 1 ? "is" : "are";
    const total = money(dueSoon.totalCents);
    const subject = `${counted(dueSoon.count, "invoice")} ${verb} due ${WINDOW}`;
    const text = `${subject}, totalling ${total}`;
    // After overdue invoices, the ones falling due read as "2 more are due ...".
    invoiceSentence =
      overduePhrase === null
        ? `${text}.`
        : `${overduePhrase} and ${dueSoon.count} more ${verb} due ${WINDOW} (${total}).`;
    items.push({
      id: "invoices-due-soon",
      text,
      phrase: `${subject} (${total})`,
      // The invoice list has no due-date filter, and its Sent filter leaves out invoices
      // the customer has opened, so this goes to the full list.
      href: "/invoices",
      linkLabel: "View invoices",
    });
  }
  const sentences = invoiceSentence === null ? [] : [invoiceSentence];
  const invoiceItems = items.length;

  if (facts.acceptedQuotes && facts.acceptedQuotes.count > 0) {
    const { count, totalCents } = facts.acceptedQuotes;
    items.push({
      id: "accepted-quotes",
      text: `${counted(count, "accepted quote")} ${count === 1 ? "is" : "are"} ready to invoice, worth ${money(totalCents)}`,
      phrase: `${counted(count, "accepted quote")} to invoice (${money(totalCents)})`,
      href: "/quotes?status=accepted",
      linkLabel: "Create invoices",
    });
  }
  if (facts.quotesExpiringSoon && facts.quotesExpiringSoon.count > 0) {
    const { count, totalCents } = facts.quotesExpiringSoon;
    items.push({
      id: "quotes-expiring-soon",
      text: `${counted(count, "quote")} ${count === 1 ? "expires" : "expire"} ${WINDOW}, worth ${money(totalCents)}`,
      phrase: `${counted(count, "quote")} expiring ${WINDOW} (${money(totalCents)})`,
      href: "/quotes",
      linkLabel: "View quotes",
    });
  }
  if (facts.receiptsToReview && facts.receiptsToReview.count > 0) {
    const { count } = facts.receiptsToReview;
    items.push({
      id: "pending-receipts",
      text: `${counted(count, "receipt")} ${count === 1 ? "needs" : "need"} review`,
      phrase: `${counted(count, "receipt")} to review`,
      href: "/books/receipts?status=pending",
      linkLabel: "Review receipts",
    });
  }
  if (facts.draftInvoices && facts.draftInvoices.count > 0) {
    const { count } = facts.draftInvoices;
    items.push({
      id: "draft-invoices",
      text: `${counted(count, "draft invoice")} ${count === 1 ? "is" : "are"} unfinished`,
      phrase: counted(count, "draft invoice"),
      href: "/invoices?status=draft",
      linkLabel: "Finish drafts",
    });
  }
  if (facts.gstToLodge) {
    const { periodLabel, netGstCents } = facts.gstToLodge;
    const amount = gstAmount(netGstCents, money);
    items.push({
      id: "gst-to-lodge",
      text: `GST for ${periodLabel} is not marked as lodged${amount ? `: ${amount}` : ""}`,
      phrase: `GST for ${periodLabel} to lodge${amount ? ` (${amount})` : ""}`,
      href: "/books/tax",
      linkLabel: "Open tax",
    });
  }

  const rest = items.slice(invoiceItems);
  if (rest.length > 0) {
    const lead = sentences.length > 0 ? "Also waiting" : "Waiting for you";
    sentences.push(`${lead}: ${joinList(rest.map((item) => item.phrase))}.`);
  }
  return {
    headline: sentences.length > 0 ? sentences.join(" ") : NOTHING_TO_REPORT,
    items,
    empty: items.length === 0,
  };
}
