import type { BookTransactionId, FileId, ReceiptExtractionId, WorkspaceId } from "@/types/ids";

export interface ExtractedReceiptData {
  merchant: string;
  /** ISO date string from the model; coerced to a Date on apply. */
  date: string;
  totalCents: number;
  taxCents: number;
  currency: string;
  /** Best-fit Books expense category slug (validated against the catalog on apply). */
  category: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }>;
  /** 0..1 - surfaced in the queue so low-confidence rows get human review. */
  confidence: number;
}

export interface ExtractionRow {
  id: ReceiptExtractionId;
  workspaceId: WorkspaceId;
  fileId: FileId;
  status: "pending" | "reviewed" | "applied" | "rejected";
  processing: boolean;
  extractedData: ExtractedReceiptData | null;
  transactionId: BookTransactionId | null;
  errorMessage: string | null;
  modelUsed: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplyExtractionPatch {
  type?: "income" | "expense";
  amountCents?: number;
  gstCents?: number;
  currency?: string;
  date?: Date;
  description?: string;
  category?: string;
  customerId?: string | null;
  notes?: string | null;
}
