import type { InvoiceStatus } from "@/lib/domain/database-enums";

/**
 * How an invoice status is shown, in one place. The list, the detail page and the public
 * payment page each used to carry their own map and they had drifted apart (a paid invoice
 * was green in the list and plain on the detail page). Colours follow the design system's
 * status pills: success for paid, warning for awaiting payment, destructive for overdue,
 * neutral for draft and void.
 */
export type StatusBadgeVariant =
  "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

export interface StatusDisplay {
  label: string;
  variant: StatusBadgeVariant;
}

/** Wording for the people who run the workspace. */
export const INVOICE_STATUS_DISPLAY: Record<InvoiceStatus, StatusDisplay> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "warning" },
  viewed: { label: "Viewed", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Void", variant: "secondary" },
};

/** Wording for the customer on the public payment page. Same colours as the staff view. */
export const INVOICE_PUBLIC_STATUS_DISPLAY: Record<InvoiceStatus, StatusDisplay> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Awaiting payment", variant: "warning" },
  viewed: { label: "Awaiting payment", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Voided", variant: "secondary" },
};
