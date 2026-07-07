/**
 * Activity label registry — pure presentation data mapping an event `type`
 * (from the platform event catalog) to a human label and tone. No DB / no
 * `server-only` import so it unit-tests cleanly and the UI layer can import it.
 *
 * Labels are past-tense fragments that read after the actor name, e.g.
 * "Jane added a customer". Unknown types fall back to a humanised version of
 * the type string so newly-added module events still render sensibly.
 */

export type ActivityTone = "neutral" | "positive" | "info" | "warning" | "danger";

export interface ActivityLabel {
  /** Past-tense fragment, e.g. "added a customer". */
  label: string;
  tone: ActivityTone;
}

export const ACTIVITY_LABELS: Record<string, ActivityLabel> = {
  WorkspaceCreated: { label: "created the workspace", tone: "positive" },
  WorkspaceUpdated: { label: "updated the workspace settings", tone: "neutral" },
  ModuleEnabled: { label: "enabled a module", tone: "info" },
  ModuleDisabled: { label: "disabled a module", tone: "neutral" },
  ModuleCancelled: { label: "cancelled a module", tone: "warning" },
  CustomerCreated: { label: "added a customer", tone: "positive" },
  CustomerUpdated: { label: "updated a customer", tone: "neutral" },
  CustomerDeleted: { label: "deleted a customer", tone: "danger" },
  MemberInvited: { label: "invited a member", tone: "info" },
  MemberAdded: { label: "added a member", tone: "positive" },
  MemberRoleChanged: { label: "changed a member's role", tone: "warning" },
  QuoteSent: { label: "sent a quote", tone: "info" },
  QuoteViewed: { label: "viewed a quote", tone: "neutral" },
  QuoteAccepted: { label: "accepted a quote", tone: "positive" },
  QuoteDeclined: { label: "declined a quote", tone: "danger" },
  QuoteConvertedToInvoice: { label: "converted a quote to an invoice", tone: "positive" },
  QuoteExpired: { label: "expired a quote", tone: "warning" },
  InvoiceCreated: { label: "created an invoice", tone: "positive" },
  InvoiceSent: { label: "sent an invoice", tone: "info" },
  InvoiceViewed: { label: "viewed an invoice", tone: "neutral" },
  InvoicePaid: { label: "paid an invoice", tone: "positive" },
  InvoiceOverdue: { label: "marked an invoice overdue", tone: "warning" },
  InvoiceVoided: { label: "voided an invoice", tone: "danger" },
  TransactionCreated: { label: "recorded a transaction", tone: "positive" },
  TransactionUpdated: { label: "edited a transaction", tone: "neutral" },
  TransactionDeleted: { label: "deleted a transaction", tone: "danger" },
  ReceiptUploaded: { label: "uploaded a receipt", tone: "info" },
  ReceiptProcessed: { label: "processed a receipt", tone: "positive" },
  MileageLogged: { label: "logged mileage", tone: "info" },
  MileageUpdated: { label: "edited a trip", tone: "neutral" },
  MileageDeleted: { label: "deleted a trip", tone: "danger" },
  DriveEarningsLogged: { label: "logged drive earnings", tone: "info" },
  DriveEarningUpdated: { label: "edited drive earnings", tone: "neutral" },
  DriveEarningDeleted: { label: "deleted drive earnings", tone: "danger" },
  VehicleExpenseLogged: { label: "logged a vehicle expense", tone: "info" },
  VehicleExpenseUpdated: { label: "edited a vehicle expense", tone: "neutral" },
  VehicleExpenseDeleted: { label: "deleted a vehicle expense", tone: "danger" },
  SubscriptionChanged: { label: "changed the subscription", tone: "warning" },
  CreditIssued: { label: "issued platform credit", tone: "positive" },
  RefundIssued: { label: "issued a refund", tone: "warning" },
  CreditExpired: { label: "expired platform credit", tone: "warning" },
};

const FALLBACK_TONE: ActivityTone = "neutral";

/** Humanise a CamelCase event type as a fallback label, e.g. "FooBarBaz" → "foo bar baz". */
function humaniseType(type: string): string {
  const spaced = type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced.toLowerCase();
}

export function describeActivity(type: string): ActivityLabel {
  return ACTIVITY_LABELS[type] ?? { label: humaniseType(type), tone: FALLBACK_TONE };
}
