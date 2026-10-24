import type { CustomerId } from "@/types/ids";

export type InvoiceEmailMeta = {
  number: string;
  totalCents: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  customerId: CustomerId | null;
  publicToken: string;
  dueDate: Date | null;
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
