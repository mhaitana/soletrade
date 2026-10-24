/**
 * Enum type aliases for the 13 Postgres enums, re-exported from the generated
 * Supabase `Database` types. This shim replaces the former Drizzle `pgEnum`
 * definitions in `src/server/db/schema/enums.ts` (deleted in the Phase 7
 * Drizzle removal) so the ~35 `import type { X } from "@/lib/domain/database-enums"`
 * call sites repoint to `@/server/db/enums` with no change to the type names.
 *
 * The string-union values are identical to the old `pgEnum(...)` enumValues -
 * `supabase gen types` reads them from the live DB, which the Drizzle
 * migrations created. Add new enum values via a Supabase migration, then
 * regenerate `types.ts`.
 */

/** Workspace roles (brief §11). Ordered loosely by privilege - do not rely on order for authz. */
export type WorkspaceRole = "owner" | "admin" | "manager" | "accountant" | "employee" | "readonly";

/** Product modules - mirrors shared/constants/modules MODULE_KEYS. */
export type ModuleKey = "invoices" | "books" | "drive" | "quotes";

export type ModuleInstallationStatus = "active" | "cancelled";

export type InvitationStatus = "pending" | "accepted" | "revoked";

/**
 * Billing enums (Phase 4). One subscription per workspace; credit ledger is
 * append-only with signed entries - the balance is always derived (SUM), never
 * stored as a mutable column.
 *
 * Brief §10 - there is no Free/Pro tier. A workspace's billing is determined by its
 * active modules (the highest-standalone is the anchor app, charged standalone; the
 * rest are add-ons). `billing_interval` records whether the unified Stripe
 * subscription bills monthly or annually; it is null when billing has not started.
 */
export type BillingInterval = "monthly" | "annual";

export type SubscriptionStatus = "active" | "past_due" | "canceled" | "incomplete";

export type CreditEntryType =
  "grant" | "consumption" | "refund" | "adjustment" | "promotion" | "expired";

/**
 * Invoice lifecycle. `draft → sent → paid | void`; `viewed` is set by the 5b public-page
 * view tracker (sent → viewed, idempotent); `overdue` is set by the 5b cron job for sent/viewed
 * invoices past their due date. A paid/void invoice is terminal; overdue invoices can still
 * be paid.
 */
export type InvoiceStatus = "draft" | "sent" | "viewed" | "paid" | "void" | "overdue";

/**
 * Quote lifecycle (Phase 8). `draft → sent → viewed → (accepted | declined | expired)`;
 * `accepted → converted` (terminal). `viewed` is set by the public-page view tracker
 * (sent → viewed, idempotent). `expired` is set by the quote-expired cron for sent/viewed
 * quotes past their `validUntil` (accepted quotes don't expire - they're heading to
 * conversion). `converted` is terminal and stores `convertedInvoiceId`. Declined/expired
 * are terminal this phase (no re-send).
 */
export type QuoteStatus =
  "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired" | "converted";

/**
 * Books module (Phase 6). A book transaction is a flat ledger entry - `income` adds
 * to the workspace's net, `expense` subtracts. There is no lifecycle / status flow
 * (unlike invoices); a transaction is just a dated row. Categories are slugs from the
 * pure `src/shared/constants/books-categories` catalog, stored as `text` so the seed
 * list can grow without a migration.
 */
export type BookType = "income" | "expense";

/**
 * Receipt extraction lifecycle (Wave 2). `pending` = extracted, awaiting human
 * review in the queue; `reviewed` = a human has opened/edited it (intermediate);
 * `applied` = the extracted data was written to a `book_transactions` row (terminal);
 * `rejected` = discarded without creating a transaction (terminal). Set
 * `transactionId` + `errorMessage` as the flow progresses.
 */
export type ReceiptExtractionStatus = "pending" | "reviewed" | "applied" | "rejected";

/**
 * Vehicle expense categories (Wave 2 Drive). Fuel/maintenance/insurance/registration
 * are the common deductible vehicle costs; `other` catches everything else. Stored as
 * a real enum (small fixed set, unlike platform slugs which grow).
 */
export type VehicleExpenseType = "fuel" | "maintenance" | "insurance" | "registration" | "other";

/**
 * AI assistant (Phase 10). Only `user` and `assistant` text is persisted - tool calls
 * and tool results are NOT replayed (read-only Q&A; the model re-derives data per turn
 * via tools rather than trusting cached tool output).
 */
export type AiMessageRole = "user" | "assistant";
