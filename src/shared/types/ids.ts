/**
 * Branded ID types — nominal typing across entity boundaries so a WorkspaceId
 * can't be passed where a UserId is expected. Brand is erased at runtime (it's
 * just a string). Brief §7: "strongly typed IDs everywhere".
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type WorkspaceMemberId = Brand<string, "WorkspaceMemberId">;
export type WorkspaceInvitationId = Brand<string, "WorkspaceInvitationId">;
export type ModuleInstallationId = Brand<string, "ModuleInstallationId">;
export type ActivityEventId = Brand<string, "ActivityEventId">;
export type AuditLogId = Brand<string, "AuditLogId">;
export type CustomerId = Brand<string, "CustomerId">;
export type InvoiceId = Brand<string, "InvoiceId">;
export type InvoiceLineItemId = Brand<string, "InvoiceLineItemId">;
export type QuoteId = Brand<string, "QuoteId">;
export type QuoteLineItemId = Brand<string, "QuoteLineItemId">;
export type BookTransactionId = Brand<string, "BookTransactionId">;
export type DriveEarningId = Brand<string, "DriveEarningId">;
export type DriveTripId = Brand<string, "DriveTripId">;
export type DriveExpenseId = Brand<string, "DriveExpenseId">;
export type VehicleId = Brand<string, "VehicleId">;
export type DriverProfileId = Brand<string, "DriverProfileId">;
export type FileId = Brand<string, "FileId">;
export type ReceiptExtractionId = Brand<string, "ReceiptExtractionId">;
export type TaxPeriodId = Brand<string, "TaxPeriodId">;
export type QuoteSectionId = Brand<string, "QuoteSectionId">;
export type QuoteAcceptanceId = Brand<string, "QuoteAcceptanceId">;
export type SubscriptionId = Brand<string, "SubscriptionId">;
export type NotificationId = Brand<string, "NotificationId">;
export type CreditLedgerEntryId = Brand<string, "CreditLedgerEntryId">;
export type AiConversationId = Brand<string, "AiConversationId">;
export type AiMessageId = Brand<string, "AiMessageId">;

/** Cast a runtime string to a branded ID (no validation — use at trust boundaries). */
export function branded<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}

/** Generate a new random branded ID (server-side). */
export function newId<B extends string>(): Brand<string, B> {
  return crypto.randomUUID() as Brand<string, B>;
}
