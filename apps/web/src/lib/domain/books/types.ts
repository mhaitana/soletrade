import type { BookType } from "@/lib/domain/database-enums";
import type {
  BookTransactionId,
  CustomerId,
  DriveEarningId,
  DriveExpenseId,
  DriveTripId,
  FileId,
  InvoiceId,
  WorkspaceId,
} from "@/types/ids";

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
