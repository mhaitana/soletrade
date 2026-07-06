import "server-only";
import { and, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { bookTransactions, customers } from "@/server/db/schema";
import { getCustomer } from "@/platform/customers";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { isBookCategory } from "@/shared/constants/books-categories";
import type { BookType } from "@/server/db/schema/enums";
import type {
  BookTransactionId,
  CustomerId,
  DriveEarningId,
  DriveExpenseId,
  FileId,
  InvoiceId,
  UserId,
  WorkspaceId,
} from "@/shared/types/ids";

/**
 * Books module service (Phase 6). Workspace-scoped CRUD for flat income/expense
 * transactions. All queries filter `eq(bookTransactions.workspaceId, workspaceId)` —
 * never trust a client workspace id; the caller resolves it from the session
 * (`requireWorkspaceContext`).
 *
 * Unlike invoices, transactions have no lifecycle / status: a row is a dated ledger
 * entry (income adds to net, expense subtracts). Money is integer cents. Categories are
 * slugs from the pure `books-categories` catalog, validated per `type` here as a
 * defensive guard (the action already validates). Delete is hard-delete + audit-logged;
 * soft-delete/trash is a later phase. No event-bus cross-module integration yet (the
 * future `InvoicePaid → Books income` link will subscribe in `src/instrumentation.ts`).
 */

export interface TransactionInput {
  type: BookType;
  amountCents: number;
  currency?: string;
  /** User-chosen transaction date. */
  date: Date;
  description: string;
  /** Slug from `books-categories`, must match `type`. */
  category: string;
  customerId?: CustomerId | null;
  notes?: string | null;
  /**
   * GST portion of this transaction in cents (Wave 2). 0 for non-GST transactions. Income
   * GST is collected from the customer; expense GST is paid (claimable). Defaults to 0.
   */
  gstCents?: number;
  /**
   * Optional link to the invoice that generated this income (Phase 6c). Set by the
   * `InvoicePaid` subscriber; null for manually-recorded transactions. Stored on
   * `book_transactions.source_invoice_id` (no FK constraint).
   */
  sourceInvoiceId?: InvoiceId | null;
  /**
   * Optional link to the Drive earning that generated this income (Phase 7). Set by the
   * `DriveEarningsLogged` subscriber; null for manually-recorded transactions. Stored on
   * `book_transactions.source_earning_id` (no FK constraint).
   */
  sourceEarningId?: DriveEarningId | null;
  /**
   * Optional link to the Drive vehicle expense that generated this expense row (Wave 2).
   * Set by the `VehicleExpenseLogged` subscriber; null otherwise. Stored on
   * `book_transactions.source_expense_id` (no FK constraint).
   */
  sourceExpenseId?: DriveExpenseId | null;
  /**
   * Optional link to a receipt file (Phase 11b). Stored on
   * `book_transactions.receipt_file_id` (no FK constraint — keeps Books decoupled from
   * the files table at the DB level). Null for transactions without a receipt.
   */
  receiptFileId?: FileId | null;
}

export type TransactionPatch = Partial<TransactionInput>;

export interface TransactionRow {
  id: BookTransactionId;
  workspaceId: WorkspaceId;
  type: BookType;
  amountCents: number;
  /** GST portion of this transaction in cents (0 for non-GST rows). */
  gstCents: number;
  currency: string;
  date: Date;
  description: string;
  category: string;
  customerId: CustomerId | null;
  /** Joined from `customers.name`; null for walk-in / no customer. */
  customerName: string | null;
  /** The invoice that generated this income, or null. */
  sourceInvoiceId: InvoiceId | null;
  /** The Drive earning that generated this income, or null. */
  sourceEarningId: DriveEarningId | null;
  /** The Drive vehicle expense that generated this expense, or null. */
  sourceExpenseId: DriveExpenseId | null;
  /** The receipt file attached to this transaction, or null. */
  receiptFileId: FileId | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const selectTransaction = {
  id: bookTransactions.id,
  workspaceId: bookTransactions.workspaceId,
  type: bookTransactions.type,
  amountCents: bookTransactions.amountCents,
  gstCents: bookTransactions.gstCents,
  currency: bookTransactions.currency,
  date: bookTransactions.date,
  description: bookTransactions.description,
  category: bookTransactions.category,
  customerId: bookTransactions.customerId,
  sourceInvoiceId: bookTransactions.sourceInvoiceId,
  sourceEarningId: bookTransactions.sourceEarningId,
  sourceExpenseId: bookTransactions.sourceExpenseId,
  receiptFileId: bookTransactions.receiptFileId,
  notes: bookTransactions.notes,
  createdAt: bookTransactions.createdAt,
  updatedAt: bookTransactions.updatedAt,
} as const;

/** Verify a category slug is in the catalog for the given `type`. */
function assertCategoryForType(type: BookType, category: string): void {
  if (!isBookCategory(type, category)) {
    throw new Error(`Unknown category "${category}" for ${type} transactions.`);
  }
}

/** Verify a customer belongs to the workspace (IDOR guard). Throws if set but not found. */
async function assertCustomerInWorkspace(
  workspaceId: WorkspaceId,
  customerId: CustomerId | null | undefined,
): Promise<void> {
  if (!customerId) return;
  const c = await getCustomer(workspaceId, customerId);
  if (!c) throw new Error("Customer not found in this workspace.");
}

/**
 * Create a transaction. Validates the category matches `type` and the customer (if any) is in
 * the workspace. `actorId` is optional — `undefined` marks a system-generated transaction (e.g.
 * the `InvoicePaid` subscriber records income on behalf of the user who marked the invoice
 * paid, or the system for the Stripe webhook path); the audit log + event carry
 * `actorUserId: undefined` in that case.
 */
export async function createTransaction(
  workspaceId: WorkspaceId,
  input: TransactionInput,
  actorId?: UserId,
): Promise<BookTransactionId> {
  if (input.amountCents <= 0) throw new Error("Amount must be greater than 0.");
  assertCategoryForType(input.type, input.category);
  await assertCustomerInWorkspace(workspaceId, input.customerId ?? null);

  const db = getDb();
  const rows = await db
    .insert(bookTransactions)
    .values({
      workspaceId,
      type: input.type,
      amountCents: input.amountCents,
      gstCents: input.gstCents ?? 0,
      currency: input.currency ?? "AUD",
      date: input.date,
      description: input.description.trim(),
      category: input.category,
      customerId: input.customerId ?? null,
      sourceInvoiceId: input.sourceInvoiceId ?? null,
      sourceEarningId: input.sourceEarningId ?? null,
      sourceExpenseId: input.sourceExpenseId ?? null,
      receiptFileId: input.receiptFileId ?? null,
      notes: input.notes ?? null,
    })
    .returning({ id: bookTransactions.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create transaction.");

  await publishEvent({
    type: "TransactionCreated",
    workspaceId,
    actorUserId: actorId,
    entityType: "transaction",
    entityId: row.id,
    metadata: {
      type: input.type,
      amountCents: input.amountCents,
      category: input.category,
      description: input.description.trim(),
      ...(input.sourceInvoiceId ? { sourceInvoiceId: input.sourceInvoiceId } : {}),
      ...(input.sourceEarningId ? { sourceEarningId: input.sourceEarningId } : {}),
      ...(input.receiptFileId ? { receiptFileId: input.receiptFileId } : {}),
    },
  });
  // A receipt attached at create time fires ReceiptUploaded (Phase 11b). The activity
  // feed records it via the persister; the books module stays decoupled from files.
  if (input.receiptFileId) {
    await publishEvent({
      type: "ReceiptUploaded",
      workspaceId,
      actorUserId: actorId,
      entityType: "file",
      entityId: input.receiptFileId,
      metadata: { transactionId: row.id },
    });
  }
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "transaction.create",
    targetType: "transaction",
    targetId: row.id,
    metadata: {
      type: input.type,
      amountCents: input.amountCents,
      category: input.category,
      ...(input.sourceInvoiceId
        ? { sourceInvoiceId: input.sourceInvoiceId, source: "invoice" }
        : {}),
      ...(input.sourceEarningId ? { sourceEarningId: input.sourceEarningId, source: "drive" } : {}),
    },
  });
  return row.id;
}

/** Update a transaction (workspace-isolated). Throws if not found. */
export async function updateTransaction(
  workspaceId: WorkspaceId,
  txId: BookTransactionId,
  patch: TransactionPatch,
  actorId: UserId,
): Promise<void> {
  if (patch.type !== undefined && patch.category !== undefined) {
    assertCategoryForType(patch.type, patch.category);
  } else if (patch.type !== undefined) {
    // Type is changing but category isn't being supplied — the existing category may no
    // longer be valid. Require the caller to supply a category when changing type.
    throw new Error("Category is required when changing transaction type.");
  } else if (patch.category !== undefined) {
    // Category is changing without a type — validate against the EXISTING type.
    const db = getDb();
    const existing = await db
      .select({ type: bookTransactions.type })
      .from(bookTransactions)
      .where(and(eq(bookTransactions.id, txId), eq(bookTransactions.workspaceId, workspaceId)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new Error("Transaction not found.");
    assertCategoryForType(row.type, patch.category);
  }
  if (patch.amountCents !== undefined && patch.amountCents <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  await assertCustomerInWorkspace(workspaceId, patch.customerId ?? null);

  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.amountCents !== undefined) set.amountCents = patch.amountCents;
  if (patch.gstCents !== undefined) set.gstCents = patch.gstCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.date !== undefined) set.date = patch.date;
  if (patch.description !== undefined) set.description = patch.description.trim();
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.customerId !== undefined) set.customerId = patch.customerId ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.receiptFileId !== undefined) set.receiptFileId = patch.receiptFileId ?? null;

  const rows = await db
    .update(bookTransactions)
    .set(set)
    .where(and(eq(bookTransactions.id, txId), eq(bookTransactions.workspaceId, workspaceId)))
    .returning({ id: bookTransactions.id });
  if (!rows[0]) throw new Error("Transaction not found.");

  await publishEvent({
    type: "TransactionUpdated",
    workspaceId,
    actorUserId: actorId,
    entityType: "transaction",
    entityId: txId,
    metadata: { fields: Object.keys(patch) },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "transaction.update",
    targetType: "transaction",
    targetId: txId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** Hard-delete a transaction (workspace-isolated). Returns false if not found in this workspace. */
export async function deleteTransaction(
  workspaceId: WorkspaceId,
  txId: BookTransactionId,
  actorId: UserId,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(bookTransactions)
    .where(and(eq(bookTransactions.id, txId), eq(bookTransactions.workspaceId, workspaceId)))
    .returning({
      id: bookTransactions.id,
      type: bookTransactions.type,
      amountCents: bookTransactions.amountCents,
    });
  const row = rows[0];
  if (!row) return false;

  await publishEvent({
    type: "TransactionDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "transaction",
    entityId: txId,
    metadata: { type: row.type, amountCents: row.amountCents },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "transaction.delete",
    targetType: "transaction",
    targetId: txId,
    metadata: { type: row.type, amountCents: row.amountCents },
  });
  return true;
}

/** List transactions for a workspace, optionally filtered by type/search/customer. */
export async function listTransactions(
  workspaceId: WorkspaceId,
  opts?: {
    type?: BookType;
    search?: string;
    customerId?: CustomerId;
    /** Inclusive lower bound on `date` (transaction date). */
    dateFrom?: Date;
    /** Inclusive upper bound on `date`. */
    dateTo?: Date;
    limit?: number;
  },
): Promise<TransactionRow[]> {
  const db = getDb();
  // Default 100 (the page list view); clamped to 2000 so the summary loader can fetch a full
  // period. A workspace with >2000 transactions in a period gets an approximate summary —
  // DB-side aggregation is a later optimization.
  const limit = Math.min(opts?.limit ?? 100, 2000);
  const conditions: (SQL | undefined)[] = [eq(bookTransactions.workspaceId, workspaceId)];
  if (opts?.type) conditions.push(eq(bookTransactions.type, opts.type));
  if (opts?.customerId) conditions.push(eq(bookTransactions.customerId, opts.customerId));
  if (opts?.dateFrom) conditions.push(gte(bookTransactions.date, opts.dateFrom));
  if (opts?.dateTo) conditions.push(lte(bookTransactions.date, opts.dateTo));
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(
        ilike(bookTransactions.description, term),
        ilike(customers.name, term),
        ilike(customers.company, term),
      ),
    );
  }

  const rows = await db
    .select({
      ...selectTransaction,
      customerName: customers.name,
    })
    .from(bookTransactions)
    .leftJoin(customers, eq(bookTransactions.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(bookTransactions.date), desc(bookTransactions.createdAt))
    .limit(limit);

  return rows.map(({ customerName, ...tx }) => ({ ...tx, customerName: customerName ?? null }));
}

/**
 * Fetch a single transaction, scoped to the workspace. IDOR-safe — returns null when the
 * transaction belongs to another workspace.
 */
export async function getTransaction(
  workspaceId: WorkspaceId,
  txId: BookTransactionId,
): Promise<TransactionRow | null> {
  const db = getDb();
  const rows = await db
    .select({ ...selectTransaction, customerName: customers.name })
    .from(bookTransactions)
    .leftJoin(customers, eq(bookTransactions.customerId, customers.id))
    .where(and(eq(bookTransactions.id, txId), eq(bookTransactions.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { customerName, ...tx } = row;
  return { ...tx, customerName: customerName ?? null };
}

// Re-export the pure aggregator (Phase 9 cross-module dashboard loader uses it).
export {
  summarizeTransactions,
  type TransactionSummary,
  type TransactionSummaryInput,
  type MonthlyNetPoint,
} from "./calc";
