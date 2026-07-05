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
]);
export type CreditEntryType = (typeof creditEntryTypeEnum.enumValues)[number];

/**
 * Invoice lifecycle (Phase 5). `viewed` is set by the 5b public-page view tracker;
 * `overdue` is set by the 5b reminder job. Phase 5a only transitions
 * `draft → sent → paid | void`; `viewed`/`overdue` are unreachable until 5b.
 */
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "sent",
  "viewed",
  "paid",
  "void",
]);
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
