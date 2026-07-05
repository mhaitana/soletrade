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
export type FileId = Brand<string, "FileId">;
export type SubscriptionId = Brand<string, "SubscriptionId">;
export type CreditLedgerEntryId = Brand<string, "CreditLedgerEntryId">;

/** Cast a runtime string to a branded ID (no validation — use at trust boundaries). */
export function branded<B extends string>(value: string): Brand<string, B> {
  return value as Brand<string, B>;
}

/** Generate a new random branded ID (server-side). */
export function newId<B extends string>(): Brand<string, B> {
  return crypto.randomUUID() as Brand<string, B>;
}
