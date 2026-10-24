import type { QuoteStatus } from "@/lib/domain/database-enums";
import type { QuoteSummary } from "@/lib/domain/quotes/calc";
import type {
  CustomerId,
  InvoiceId,
  QuoteAcceptanceId,
  QuoteId,
  QuoteLineItemId,
  QuoteSectionId,
  WorkspaceId,
} from "@/types/ids";

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface SectionInput {
  title: string;
  body: string;
  /** True = the customer can opt into this section at accept time. */
  optional?: boolean;
}

export interface QuoteInput {
  customerId?: CustomerId | null;
  issueDate: Date;
  validUntil?: Date | null;
  currency?: string;
  /** Integer percent (10 = 10% GST). */
  taxRate: number;
  /** When true, line-item unit prices are tax-inclusive (gross); tax is back-calculated. */
  pricesIncludeTax?: boolean;
  notes?: string | null;
  /** Terms & Conditions shown on the public page above the accept button (Wave 2). */
  termsConditions?: string | null;
  lineItems: LineItemInput[];
  /** Optional content sections, rendered in `position` order (Wave 2). */
  sections?: SectionInput[];
}

export type QuotePatch = Partial<QuoteInput>;

export interface QuoteRow {
  id: QuoteId;
  workspaceId: WorkspaceId;
  customerId: CustomerId | null;
  customerName: string | null;
  number: string;
  status: QuoteStatus;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  taxRate: number;
  /** True when unit prices are tax-inclusive (gross); see `QuoteInput.pricesIncludeTax`. */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  /** Terms & Conditions (Wave 2). Null = no T&Cs. */
  termsConditions: string | null;
  publicToken: string | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  convertedAt: Date | null;
  convertedInvoiceId: InvoiceId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteLineItemRow {
  id: QuoteLineItemId;
  quoteId: QuoteId;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  position: number;
}

export interface QuoteSectionRow {
  id: QuoteSectionId;
  quoteId: QuoteId;
  title: string;
  body: string;
  position: number;
  optional: boolean;
}

export interface QuoteWithItems extends QuoteRow {
  lineItems: QuoteLineItemRow[];
  /** Sections ordered by `position` (Wave 2). Empty when the quote has none. */
  sections: QuoteSectionRow[];
}

export interface PublicQuoteView {
  number: string;
  status: QuoteStatus;
  customerName: string | null;
  /** Issuing business (workspace) name - shown as the dominant brand on the public quote page. */
  merchantName: string | null;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  taxRate: number;
  /** True when unit prices are tax-inclusive (shown as "(includes $X tax)"). */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lineItems: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }[];
  /** Optional content sections (Wave 2), ordered by position. Customer-visible. */
  sections: {
    title: string;
    body: string;
    optional: boolean;
  }[];
  /** Terms & Conditions (Wave 2). Null = no T&Cs to show. */
  termsConditions: string | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  convertedInvoiceId: InvoiceId | null;
}

export interface AcceptanceMeta {
  accepterName: string;
  accepterEmail?: string | null;
  signature?: string | null;
  ipAddress: string;
  userAgent: string;
}

export interface DeclineMeta {
  ipAddress: string;
  userAgent: string;
  reason?: string | null;
}

export interface QuoteAcceptanceRow {
  id: QuoteAcceptanceId;
  quoteId: QuoteId;
  accepterName: string;
  accepterEmail: string | null;
  ipAddress: string;
  userAgent: string;
  signature: string | null;
  acceptedAt: Date;
}

export interface QuoteDashboardSummary extends QuoteSummary {
  readyCount: number;
}
