import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, pgQuote, unwrap, unwrapMaybe } from "@/server/db/helpers";
import { getCustomer } from "@/platform/customers";
import { getWorkspace } from "@/platform/workspaces";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { isBookCategory } from "@/shared/constants/books-categories";
import type { BookType } from "@/server/db/enums";
import {
  branded,
  type BookTransactionId,
  type CustomerId,
  type DriveEarningId,
  type DriveExpenseId,
  type DriveTripId,
  type FileId,
  type InvoiceId,
  type UserId,
  type WorkspaceId,
} from "@/shared/types/ids";

/**
 * Books module service (Phase 6). Workspace-scoped CRUD for flat income/expense
 * transactions. All queries filter `.eq("workspace_id", workspaceId)` - never trust a
 * client workspace id; the caller resolves it from the session (`requireWorkspaceContext`).
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
   * Optional link to the Drive trip that generated this mileage expense row (Wave 5).
   * Set by the `MileageLogged` subscriber; null otherwise. Stored on
   * `book_transactions.source_trip_id` (no FK constraint).
   */
  sourceTripId?: DriveTripId | null;
  /**
   * Optional link to a receipt file (Phase 11b). Stored on
   * `book_transactions.receipt_file_id` (no FK constraint - keeps Books decoupled from
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
  /** The Drive trip that generated this mileage expense, or null. */
  sourceTripId: DriveTripId | null;
  /** The receipt file attached to this transaction, or null. */
  receiptFileId: FileId | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionSource {
  module: "invoices" | "drive";
  label: string;
  href: string;
}

/**
 * Describe the canonical source of a mirrored transaction. Source-linked rows are read-only
 * in Books: changing the invoice or Drive record updates the mirror atomically.
 */
export function transactionSource(
  transaction: Pick<
    TransactionRow,
    "sourceInvoiceId" | "sourceEarningId" | "sourceExpenseId" | "sourceTripId"
  >,
): TransactionSource | null {
  if (transaction.sourceInvoiceId) {
    return {
      module: "invoices",
      label: "Invoice",
      href: `/invoices/${transaction.sourceInvoiceId}`,
    };
  }
  if (transaction.sourceEarningId) {
    return { module: "drive", label: "Drive earning", href: "/drive" };
  }
  if (transaction.sourceExpenseId) {
    return { module: "drive", label: "Drive expense", href: "/drive/expenses" };
  }
  if (transaction.sourceTripId) {
    return { module: "drive", label: "Drive mileage", href: "/drive" };
  }
  return null;
}

type SourceSyncOptions = { allowSourceSync?: boolean };

async function assertTransactionIsEditable(
  workspaceId: WorkspaceId,
  txId: BookTransactionId,
  opts?: SourceSyncOptions,
  missingIsNoOp = false,
): Promise<boolean> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("book_transactions")
      .select("source_invoice_id, source_earning_id, source_expense_id, source_trip_id")
      .eq("id", txId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!row) {
    if (missingIsNoOp) return false;
    throw new Error("Transaction not found.");
  }
  if (
    !opts?.allowSourceSync &&
    (row.source_invoice_id || row.source_earning_id || row.source_expense_id || row.source_trip_id)
  ) {
    throw new Error(
      "This transaction is synced from another module. Edit the invoice or Drive record instead.",
    );
  }
  return true;
}

/**
 * Columns selected from `book_transactions`, with the `customers` parent embedded via a
 * LEFT join (`!left`) so transactions with no customer still return with `customers: null`
 * - matching the original Drizzle `leftJoin`. `customerName` is read from the embedded
 * `customers.name`. The `date` column is `timestamp without time zone`; `parsePgTimestamp`
 * re-interprets the no-offset PostgREST string as UTC (matching node-postgres/Drizzle).
 */
const TRANSACTION_COLUMNS =
  "id, workspace_id, type, amount_cents, gst_cents, currency, date, description, category, customer_id, source_invoice_id, source_earning_id, source_expense_id, source_trip_id, receipt_file_id, notes, created_at, updated_at, customers!left ( name )";

/** Raw snake_case shape PostgREST returns for a `book_transactions` row + embedded customer. */
interface TransactionRaw {
  id: string;
  workspace_id: string;
  type: string;
  amount_cents: number;
  gst_cents: number;
  currency: string;
  date: string;
  description: string;
  category: string;
  customer_id: string | null;
  source_invoice_id: string | null;
  source_earning_id: string | null;
  source_expense_id: string | null;
  source_trip_id: string | null;
  receipt_file_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customers: { name: string | null } | null;
}

/** Maps a snake_case PostgREST row to the camelCase `TransactionRow`. */
function toTransactionRow(r: TransactionRaw): TransactionRow {
  return {
    id: branded<"BookTransactionId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    type: r.type as BookType,
    amountCents: r.amount_cents,
    gstCents: r.gst_cents,
    currency: r.currency,
    date: parsePgTimestamp(r.date),
    description: r.description,
    category: r.category,
    customerId: r.customer_id ? branded<"CustomerId">(r.customer_id) : null,
    customerName: r.customers?.name ?? null,
    sourceInvoiceId: r.source_invoice_id ? branded<"InvoiceId">(r.source_invoice_id) : null,
    sourceEarningId: r.source_earning_id ? branded<"DriveEarningId">(r.source_earning_id) : null,
    sourceExpenseId: r.source_expense_id ? branded<"DriveExpenseId">(r.source_expense_id) : null,
    sourceTripId: r.source_trip_id ? branded<"DriveTripId">(r.source_trip_id) : null,
    receiptFileId: r.receipt_file_id ? branded<"FileId">(r.receipt_file_id) : null,
    notes: r.notes,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

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
 * the workspace. `actorId` is optional - `undefined` marks a system-generated transaction (e.g.
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

  const supabase = getDataClient();
  // Default currency from the workspace row (migration 0018); fall back to AUD if missing.
  const workspace = await getWorkspace(workspaceId);
  const defaultCurrency = workspace?.defaultCurrency ?? "AUD";
  // `date` is `timestamp without time zone`; `toISOString()` (UTC) round-trips exactly -
  // PostgREST casts the Z-string to the no-tz type by keeping the UTC wall-time literal,
  // which is what node-postgres/Drizzle stored for the same Date.
  const rows = await unwrap(
    supabase
      .from("book_transactions")
      .insert({
        workspace_id: workspaceId,
        type: input.type,
        amount_cents: input.amountCents,
        gst_cents: input.gstCents ?? 0,
        currency: input.currency ?? defaultCurrency,
        date: input.date.toISOString(),
        description: input.description.trim(),
        category: input.category,
        customer_id: input.customerId ?? null,
        source_invoice_id: input.sourceInvoiceId ?? null,
        source_earning_id: input.sourceEarningId ?? null,
        source_expense_id: input.sourceExpenseId ?? null,
        source_trip_id: input.sourceTripId ?? null,
        receipt_file_id: input.receiptFileId ?? null,
        notes: input.notes ?? null,
      })
      .select("id"),
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create transaction.");
  const id = branded<"BookTransactionId">(row.id);

  await publishEvent({
    type: "TransactionCreated",
    workspaceId,
    actorUserId: actorId,
    entityType: "transaction",
    entityId: id,
    metadata: {
      type: input.type,
      amountCents: input.amountCents,
      category: input.category,
      description: input.description.trim(),
      ...(input.sourceInvoiceId ? { sourceInvoiceId: input.sourceInvoiceId } : {}),
      ...(input.sourceEarningId ? { sourceEarningId: input.sourceEarningId } : {}),
      ...(input.sourceExpenseId ? { sourceExpenseId: input.sourceExpenseId } : {}),
      ...(input.sourceTripId ? { sourceTripId: input.sourceTripId } : {}),
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
      metadata: { transactionId: id },
    });
  }
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "transaction.create",
    targetType: "transaction",
    targetId: id,
    metadata: {
      type: input.type,
      amountCents: input.amountCents,
      category: input.category,
      ...(input.sourceInvoiceId
        ? { sourceInvoiceId: input.sourceInvoiceId, source: "invoice" }
        : {}),
      ...(input.sourceEarningId ? { sourceEarningId: input.sourceEarningId, source: "drive" } : {}),
      ...(input.sourceExpenseId ? { sourceExpenseId: input.sourceExpenseId, source: "drive" } : {}),
      ...(input.sourceTripId ? { sourceTripId: input.sourceTripId, source: "drive" } : {}),
    },
  });
  return id;
}

/** Update a transaction (workspace-isolated). Throws if not found. */
export async function updateTransaction(
  workspaceId: WorkspaceId,
  txId: BookTransactionId,
  patch: TransactionPatch,
  actorId?: UserId,
  opts?: SourceSyncOptions,
): Promise<void> {
  await assertTransactionIsEditable(workspaceId, txId, opts);
  if (patch.type !== undefined && patch.category !== undefined) {
    assertCategoryForType(patch.type, patch.category);
  } else if (patch.type !== undefined) {
    // Type is changing but category isn't being supplied - the existing category may no
    // longer be valid. Require the caller to supply a category when changing type.
    throw new Error("Category is required when changing transaction type.");
  } else if (patch.category !== undefined) {
    // Category is changing without a type - validate against the EXISTING type.
    const supabase = getDataClient();
    const existing = await unwrapMaybe(
      supabase
        .from("book_transactions")
        .select("type")
        .eq("id", txId)
        .eq("workspace_id", workspaceId)
        .limit(1)
        .maybeSingle(),
    );
    if (!existing) throw new Error("Transaction not found.");
    assertCategoryForType(existing.type as BookType, patch.category);
  }
  if (patch.amountCents !== undefined && patch.amountCents <= 0) {
    throw new Error("Amount must be greater than 0.");
  }
  await assertCustomerInWorkspace(workspaceId, patch.customerId ?? null);

  const supabase = getDataClient();
  // Explicit column-keyed shape (not a loose Record<string, unknown>) so the typed
  // `.update()` payload accepts it - the generated Update type rejects an `unknown`
  // index signature. `updated_at` is always set; the rest are conditional on the patch.
  // Source-link columns (source_invoice_id etc.) are deliberately NOT mutable here,
  // matching the original Drizzle update set.
  const set: {
    updated_at: string;
    type?: BookType;
    amount_cents?: number;
    gst_cents?: number;
    currency?: string;
    date?: string;
    description?: string;
    category?: string;
    customer_id?: CustomerId | null;
    notes?: string | null;
    receipt_file_id?: FileId | null;
  } = { updated_at: new Date().toISOString() };
  if (patch.type !== undefined) set.type = patch.type;
  if (patch.amountCents !== undefined) set.amount_cents = patch.amountCents;
  if (patch.gstCents !== undefined) set.gst_cents = patch.gstCents;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (patch.date !== undefined) set.date = patch.date.toISOString();
  if (patch.description !== undefined) set.description = patch.description.trim();
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.customerId !== undefined) set.customer_id = patch.customerId ?? null;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.receiptFileId !== undefined) set.receipt_file_id = patch.receiptFileId ?? null;

  const rows = await unwrap(
    supabase
      .from("book_transactions")
      .update(set)
      .eq("id", txId)
      .eq("workspace_id", workspaceId)
      .select("id"),
  );
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
  actorId?: UserId,
  opts?: SourceSyncOptions,
): Promise<boolean> {
  if (!(await assertTransactionIsEditable(workspaceId, txId, opts, true))) return false;
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("book_transactions")
      .delete()
      .eq("id", txId)
      .eq("workspace_id", workspaceId)
      .select("id, type, amount_cents"),
  );
  const row = rows[0];
  if (!row) return false;
  const type = row.type as BookType;

  await publishEvent({
    type: "TransactionDeleted",
    workspaceId,
    actorUserId: actorId,
    entityType: "transaction",
    entityId: txId,
    metadata: { type, amountCents: row.amount_cents },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "transaction.delete",
    targetType: "transaction",
    targetId: txId,
    metadata: { type, amountCents: row.amount_cents },
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
  const supabase = getDataClient();
  // Default 100 (the page list view); clamped to 2000 so the summary loader can fetch a full
  // period. A workspace with >2000 transactions in a period gets an approximate summary -
  // DB-side aggregation is a later optimization.
  const limit = Math.min(opts?.limit ?? 100, 2000);
  let query = supabase
    .from("book_transactions")
    .select(TRANSACTION_COLUMNS)
    .eq("workspace_id", workspaceId);
  if (opts?.type) query = query.eq("type", opts.type);
  if (opts?.customerId) query = query.eq("customer_id", opts.customerId);
  // `date` is `timestamp without time zone`; pass ISO-with-Z (UTC) for the bounds -
  // PostgREST casts to the no-tz type keeping the UTC wall-time literal, matching Drizzle.
  if (opts?.dateFrom) query = query.gte("date", opts.dateFrom.toISOString());
  if (opts?.dateTo) query = query.lte("date", opts.dateTo.toISOString());
  const search = opts?.search?.trim();
  if (search) {
    // ILIKE across description + the joined customer's name/company - the original ORd
    // three parameterized ilike calls over a `leftJoin customers`. PostgREST's `or`
    // filter can't reference embedded/foreign columns, so replicate the leftJoin OR in
    // two local-column-only steps (both ORs are on columns PostgREST's `or` supports):
    //   (1) find customer ids in the workspace whose name OR company ILIKE the term - no
    //       `deleted_at` filter, matching the original leftJoin (it didn't exclude
    //       soft-deleted customers);
    //   (2) match transactions whose description ILIKE the term OR whose `customer_id` is
    //       in that set. A no-customer transaction still matches via the description
    //       branch. UUIDs carry no commas/parens so the `in.(...)` list is parser-safe.
    const term = pgQuote(`%${search}%`);
    const matchingCustomers = await unwrap(
      supabase
        .from("customers")
        .select("id")
        .eq("workspace_id", workspaceId)
        .or(`name.ilike.${term},company.ilike.${term}`),
    );
    const customerIds = matchingCustomers.map((c) => c.id);
    query =
      customerIds.length > 0
        ? query.or(`description.ilike.${term},customer_id.in.(${customerIds.join(",")})`)
        : query.or(`description.ilike.${term}`);
  }

  const rows = await unwrap(
    query
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return rows.map((r) => toTransactionRow(r as TransactionRaw));
}

/**
 * Fetch a single transaction, scoped to the workspace. IDOR-safe - returns null when the
 * transaction belongs to another workspace.
 */
export async function getTransaction(
  workspaceId: WorkspaceId,
  txId: BookTransactionId,
): Promise<TransactionRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("book_transactions")
      .select(TRANSACTION_COLUMNS)
      .eq("id", txId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  return row ? toTransactionRow(row as TransactionRaw) : null;
}

/**
 * Find the Books transaction mirrored from a cross-module source row (invoice / Drive
 * earning / Drive vehicle expense / Drive trip), scoped to the workspace. Returns the
 * transaction id or null. Used by the Drive→Books update/delete sync subscribers to
 * locate the row to update or delete, and shared with the create-side idempotency check.
 * At most one source key is expected; if more than one is supplied, the first non-null
 * one wins in this order: sourceInvoiceId, sourceEarningId, sourceExpenseId, sourceTripId.
 */
export async function findTransactionIdBySource(
  workspaceId: WorkspaceId,
  source: {
    sourceInvoiceId?: InvoiceId | null;
    sourceEarningId?: DriveEarningId | null;
    sourceExpenseId?: DriveExpenseId | null;
    sourceTripId?: DriveTripId | null;
  },
): Promise<BookTransactionId | null> {
  const supabase = getDataClient();
  let column: "source_invoice_id" | "source_earning_id" | "source_expense_id" | "source_trip_id";
  let value: string;
  if (source.sourceInvoiceId) {
    column = "source_invoice_id";
    value = source.sourceInvoiceId;
  } else if (source.sourceEarningId) {
    column = "source_earning_id";
    value = source.sourceEarningId;
  } else if (source.sourceExpenseId) {
    column = "source_expense_id";
    value = source.sourceExpenseId;
  } else if (source.sourceTripId) {
    column = "source_trip_id";
    value = source.sourceTripId;
  } else {
    return null;
  }
  const row = await unwrapMaybe(
    supabase
      .from("book_transactions")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq(column, value)
      .limit(1)
      .maybeSingle(),
  );
  return row ? branded<"BookTransactionId">(row.id) : null;
}

// Re-export the pure aggregator (Phase 9 cross-module dashboard loader uses it).
export {
  summarizeTransactions,
  type TransactionSummary,
  type TransactionSummaryInput,
  type MonthlyNetPoint,
} from "./calc";
