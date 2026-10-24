import type { InvoiceStatus } from "@/lib/domain/database-enums";
import type { InvoiceSummary } from "@/lib/domain/invoices/calc";
import type { CustomerId, InvoiceId, InvoiceLineItemId, WorkspaceId } from "@/types/ids";
import type { PaymentMethods } from "@/types/payment-methods";

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface InvoiceInput {
  customerId?: CustomerId | null;
  issueDate: Date;
  dueDate?: Date | null;
  currency?: string;
  /** Integer percent (10 = 10% GST). */
  taxRate: number;
  /** When true, line-item unit prices are tax-inclusive (gross); tax is back-calculated. */
  pricesIncludeTax?: boolean;
  notes?: string | null;
  /** Optional per-invoice payment instructions; overrides workspace default when set. */
  paymentMethods?: PaymentMethods | null;
  lineItems: LineItemInput[];
}

export type InvoicePatch = Partial<InvoiceInput>;

export interface InvoiceRow {
  id: InvoiceId;
  workspaceId: WorkspaceId;
  customerId: CustomerId | null;
  customerName: string | null;
  number: string;
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  taxRate: number;
  /** True when unit prices are tax-inclusive (gross); see `InvoiceInput.pricesIncludeTax`. */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  /** Per-invoice payment instructions (jsonb array); null when using workspace default. */
  paymentMethods: PaymentMethods | null;
  publicToken: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLineItemRow {
  id: InvoiceLineItemId;
  invoiceId: InvoiceId;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  position: number;
}

export interface InvoiceWithItems extends InvoiceRow {
  lineItems: InvoiceLineItemRow[];
}

export interface PublicInvoiceView {
  number: string;
  status: InvoiceStatus;
  customerName: string | null;
  /** Issuing business (workspace) name - shown as the dominant brand on the public invoice page. */
  merchantName: string | null;
  issueDate: Date;
  dueDate: Date | null;
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
  sentAt: Date | null;
  paidAt: Date | null;
  /** Receipt reference on the paid confirmation screen; null until payment succeeds. */
  stripeChargeId: string | null;
  /** Resolved payment methods to show the customer (invoice override → workspace default). */
  paymentMethods: PaymentMethods;
}

export interface InvoicePaymentContext {
  invoiceId: InvoiceId;
  workspaceId: WorkspaceId;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  stripePaymentIntentId: string | null;
}

export interface InvoiceDashboardSummary extends InvoiceSummary {
  overdueCents: number;
  previousPaidCents: number | null;
}
