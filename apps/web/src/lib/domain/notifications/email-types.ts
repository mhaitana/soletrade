import type { CustomerId } from "@/types/ids";
import type { InsightFacts } from "@/lib/domain/insights/facts";

export type InvoiceEmailMeta = {
  number: string;
  totalCents: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  customerId: CustomerId | null;
  publicToken: string;
  dueDate: Date | null;
  /**
   * The business the invoice is from. Not part of the event payload: the notification
   * handler looks it up from the workspace so the customer can tell who is emailing them.
   */
  merchantName?: string | null;
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type QuoteEmailMeta = {
  number: string;
  totalCents: number;
  currency: string;
  publicToken: string;
  validUntil: Date | null;
  customerEmail: string | null;
  customerName: string | null;
  customerId: CustomerId | null;
  /** The business the quote is from; resolved by the notification handler (see above). */
  merchantName?: string | null;
};

export type QuoteMerchantMeta = {
  number: string;
  totalCents: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  /** Who accepted (Wave 2). Null on `QuoteDeclined` / pre-Wave-2 events. */
  accepterName?: string | null;
  /** Acceptor IP (Wave 2). Null on `QuoteDeclined` / pre-Wave-2 events. */
  ipAddress?: string | null;
};

export type MemberInvitedEmailMeta = {
  email: string;
  role: string;
  token: string;
  workspaceName: string;
  inviterName: string | null;
};

export type RefundMeta = {
  amountCents: number;
  currency: string;
  reason: string | null;
  moduleKey: string | null;
  method: string | null;
};

export type BriefingDigestEmailMeta = {
  workspaceName: string;
  /** How often this member asked for the digest; it words the subject and the opt-out line. */
  frequency: "daily" | "weekly";
  /** The member's own facts. The email states these and nothing else. */
  facts: InsightFacts;
};
