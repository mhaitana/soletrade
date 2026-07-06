import { pgEnum } from "drizzle-orm/pg-core";
import { MODULE_KEYS } from "@/shared/constants/modules";

/** Workspace roles (brief §11). Ordered loosely by privilege — do not rely on order for authz. */
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "manager",
  "accountant",
  "employee",
  "readonly",
]);
export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];

/** Product modules — mirrors shared/constants/modules MODULE_KEYS. */
export const moduleKeyEnum = pgEnum("module_key", [...MODULE_KEYS]);
export type ModuleKey = (typeof moduleKeyEnum.enumValues)[number];

export const moduleInstallationStatusEnum = pgEnum("module_installation_status", [
  "active",
  "cancelled",
]);
export type ModuleInstallationStatus = (typeof moduleInstallationStatusEnum.enumValues)[number];

export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);
export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number];

/**
 * Billing enums (Phase 4). One subscription per workspace; credit ledger is
 * append-only with signed entries — the balance is always derived (SUM), never
 * stored as a mutable column.
 *
 * Brief §10 — there is no Free/Pro tier. A workspace's billing is determined by its
 * active modules (the highest-standalone is the anchor app, charged standalone; the
 * rest are add-ons). `billing_interval` records whether the unified Stripe
 * subscription bills monthly or annually; it is null when billing has not started.
 */
export const billingIntervalEnum = pgEnum("billing_interval", ["monthly", "annual"]);
export type BillingInterval = (typeof billingIntervalEnum.enumValues)[number];

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);
export type SubscriptionStatus = (typeof subscriptionStatusEnum.enumValues)[number];

export const creditEntryTypeEnum = pgEnum("credit_entry_type", [
  "grant",
  "consumption",
  "refund",
  "adjustment",
  "promotion",
  "expired",
]);
export type CreditEntryType = (typeof creditEntryTypeEnum.enumValues)[number];

/**
 * Invoice lifecycle. `draft → sent → paid | void`; `viewed` is set by the 5b public-page
 * view tracker (sent → viewed, idempotent); `overdue` is set by the 5b cron job for sent/viewed
 * invoices past their due date. A paid/void invoice is terminal; overdue invoices can still
 * be paid.
 */
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "viewed",
  "paid",
  "void",
  "overdue",
]);
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];

/**
 * Quote lifecycle (Phase 8). `draft → sent → viewed → (accepted | declined | expired)`;
 * `accepted → converted` (terminal). `viewed` is set by the public-page view tracker
 * (sent → viewed, idempotent). `expired` is set by the quote-expired cron for sent/viewed
 * quotes past their `validUntil` (accepted quotes don't expire — they're heading to
 * conversion). `converted` is terminal and stores `convertedInvoiceId`. Declined/expired
 * are terminal this phase (no re-send).
 */
export const quoteStatusEnum = pgEnum("quote_status", [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "converted",
]);
export type QuoteStatus = (typeof quoteStatusEnum.enumValues)[number];

/**
 * Books module (Phase 6). A book transaction is a flat ledger entry — `income` adds
 * to the workspace's net, `expense` subtracts. There is no lifecycle / status flow
 * (unlike invoices); a transaction is just a dated row. Categories are slugs from the
 * pure `src/shared/constants/books-categories` catalog, stored as `text` so the seed
 * list can grow without a migration.
 */
export const bookTypeEnum = pgEnum("book_type", ["income", "expense"]);
export type BookType = (typeof bookTypeEnum.enumValues)[number];

/**
 * AI assistant (Phase 10). Only `user` and `assistant` text is persisted — tool calls
 * and tool results are NOT replayed (read-only Q&A; the model re-derives data per turn
 * via tools rather than trusting cached tool output).
 */
export const aiMessageRoleEnum = pgEnum("ai_message_role", ["user", "assistant"]);
export type AiMessageRole = (typeof aiMessageRoleEnum.enumValues)[number];
