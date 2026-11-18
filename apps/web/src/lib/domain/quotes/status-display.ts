import type { QuoteStatus } from "@/lib/domain/database-enums";
import type { StatusDisplay } from "@/lib/domain/invoices/status-display";

/**
 * How a quote status is shown, in one place (see the invoice equivalent for why). Colours
 * follow the design system's status pills: success for accepted, warning while waiting on
 * the customer, destructive for declined or expired, neutral for draft and converted.
 */

/** Wording for the people who run the workspace. */
export const QUOTE_STATUS_DISPLAY: Record<QuoteStatus, StatusDisplay> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "warning" },
  viewed: { label: "Viewed", variant: "warning" },
  accepted: { label: "Accepted", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  converted: { label: "Converted", variant: "secondary" },
};

/**
 * Wording for the customer on the public quote page. "Converted" is internal bookkeeping:
 * to the customer it is still the quote they accepted.
 */
export const QUOTE_PUBLIC_STATUS_DISPLAY: Record<QuoteStatus, StatusDisplay> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Awaiting your response", variant: "warning" },
  viewed: { label: "Awaiting your response", variant: "warning" },
  accepted: { label: "Accepted", variant: "success" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  converted: { label: "Accepted", variant: "success" },
};
