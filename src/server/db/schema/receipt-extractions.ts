import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type {
  BookTransactionId,
  FileId,
  ReceiptExtractionId,
  UserId,
  WorkspaceId,
} from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";
import { receiptExtractionStatusEnum } from "./enums";

/**
 * Receipt extraction queue (Wave 2 — Books headline feature). One row per receipt
 * file that has been (or is being) processed by the AI extraction pipeline.
 *
 * The flow: a user uploads a receipt file (Phase 11b `files` row) and kicks off
 * extraction from the `/books/receipts` review queue. The service fetches the file
 * bytes from Supabase Storage, sends them to the vision model (Anthropic via the AI
 * SDK; the mock provider returns canned data for dev/test), and stores the structured
 * result in `extractedData`. The row starts `pending`; a human reviews it in the
 * queue, edits as needed, and either **applies** it (creates a `book_transactions` row
 * and sets `status = 'applied'` + `transactionId`) or **rejects** it.
 *
 * `fileId` is a soft link (no FK), mirroring `book_transactions.receiptFileId` — the
 * file can outlive the extraction and vice-versa. `extractedData` is the raw model
 * output (`{merchant, date, totalCents, taxCents, currency, category, lineItems,
 * confidence}`); the service validates/coerces it before persisting. `errorMessage`
 * is set when the model call fails so the row is visible in the queue as `rejected`
 * rather than silently dropped.
 */
export const receiptExtractions = pgTable(
  "receipt_extractions",
  {
    id: uuid("id").primaryKey().$type<ReceiptExtractionId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Soft link to the receipt file (no FK — mirrors `book_transactions.receiptFileId`). */
    fileId: uuid("file_id").notNull().$type<FileId>(),
    status: receiptExtractionStatusEnum("status").notNull().default("pending"),
    /**
     * Structured model output: `{merchant, date, totalCents, taxCents, currency,
     * category, lineItems: [{description, quantity, unitPriceCents, amountCents}],
     * confidence: 0..1}`. jsonb so the shape can evolve without a migration.
     */
    extractedData: jsonb("extracted_data"),
    /** Set when the extraction is applied to a `book_transactions` row. */
    transactionId: uuid("transaction_id").$type<BookTransactionId>(),
    /** Populated when the model call fails (status `rejected`, no extractedData). */
    errorMessage: text("error_message"),
    /** Which model produced this extraction (e.g. "claude-sonnet-5", "mock"). */
    modelUsed: text("model_used").notNull(),
    /** Who triggered the extraction (null for system-initiated retries). */
    actorUserId: uuid("actor_user_id")
      .$type<UserId>()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Queue view: filter by status within a workspace.
    index("receipt_extractions_workspace_status_idx").on(t.workspaceId, t.status),
    // Reverse lookup: has this receipt already been processed?
    index("receipt_extractions_workspace_file_idx").on(t.workspaceId, t.fileId),
  ],
);
