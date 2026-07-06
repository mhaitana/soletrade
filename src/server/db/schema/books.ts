import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type {
  BookTransactionId,
  CustomerId,
  DriveEarningId,
  FileId,
  InvoiceId,
  WorkspaceId,
} from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { customers } from "./customers";
import { bookTypeEnum } from "./enums";

/**
 * Books module schema (Phase 6). One flat ledger row per income/expense transaction,
 * workspace-scoped. There is no document lifecycle or status — a transaction is a dated
 * entry (income adds to net, expense subtracts). Money is integer cents throughout.
 *
 * `category` is a slug from the pure `src/shared/constants/books-categories` catalog
 * (validated at the action boundary + in the service). Stored as `text` (not an enum)
 * so the seed list can grow without a DB migration.
 *
 * `customerId` is optional — income is often tied to a customer, expenses rarely are.
 * No cascade: workspace + customer are soft-deleted parents (mirrors `invoices`), so a
 * deleted customer's historical transactions are preserved. No invoice FK yet — the
 * future `InvoicePaid → Books income` integration goes via the event bus to keep 6a
 * decoupled from the invoices module.
 */
export const bookTransactions = pgTable(
  "book_transactions",
  {
    id: uuid("id").primaryKey().$type<BookTransactionId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    type: bookTypeEnum("type").notNull(),
    /** Integer cents. Income adds, expense subtracts — sign is implied by `type`. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("AUD"),
    /** User-chosen transaction date (when the income/expense occurred). */
    date: timestamp("date").notNull(),
    description: text("description").notNull(),
    /** Slug from `src/shared/constants/books-categories`, validated per `type`. */
    category: text("category").notNull(),
    /** Optional — income is often linked to a customer; expenses usually aren't. */
    customerId: uuid("customer_id")
      .$type<CustomerId>()
      .references(() => customers.id),
    /**
     * Optional link to the invoice that generated this income (Phase 6c event-bus
     * integration). No FK constraint — keeps Books decoupled from the invoices table at the
     * DB level (cross-module coupling goes via the event bus, not FKs). Indexed for the
     * idempotency check-then-insert in the Books integration subscriber. Null for
     * manually-recorded transactions.
     */
    sourceInvoiceId: uuid("source_invoice_id").$type<InvoiceId>(),
    /**
     * Optional link to the Drive earning that generated this income (Phase 7 event-bus
     * integration). No FK constraint — keeps Books decoupled from the drive_earnings table at
     * the DB level (cross-module coupling goes via the event bus, not FKs). Indexed for the
     * idempotency check-then-insert in the Books integration subscriber. Null for
     * manually-recorded transactions and invoice-linked rows.
     */
    sourceEarningId: uuid("source_earning_id").$type<DriveEarningId>(),
    /** Private workspace note (never exposed publicly). */
    notes: text("notes"),
    /**
     * Optional link to a receipt file row (Phase 11b). No FK constraint — keeps
     * Books decoupled from the files table at the DB level, mirroring
     * `sourceInvoiceId`/`sourceEarningId`. Null for transactions without a receipt.
     */
    receiptFileId: uuid("receipt_file_id").$type<FileId>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Primary list view is "newest transaction date first"; the secondary order keeps
    // ties deterministic.
    index("book_transactions_workspace_date_idx").on(t.workspaceId, t.date),
    index("book_transactions_workspace_type_idx").on(t.workspaceId, t.type),
    index("book_transactions_workspace_customer_idx").on(t.workspaceId, t.customerId),
    // Idempotency lookup for the InvoicePaid → Books income subscriber (6c).
    index("book_transactions_workspace_source_invoice_idx").on(t.workspaceId, t.sourceInvoiceId),
    // Idempotency lookup for the DriveEarningsLogged → Books income subscriber (7).
    index("book_transactions_workspace_source_earning_idx").on(t.workspaceId, t.sourceEarningId),
  ],
);
