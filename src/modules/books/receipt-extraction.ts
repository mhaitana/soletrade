import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { getDb } from "@/server/db";
import { receiptExtractions } from "@/server/db/schema";
import { getFile, downloadFileBytes } from "@/platform/files";
import { getAIModel, isMockProvider } from "@/platform/ai/provider";
import { consumeCredit } from "@/platform/billing/credits";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { env } from "@/shared/lib/env";
import type {
  BookTransactionId,
  FileId,
  ReceiptExtractionId,
  UserId,
  WorkspaceId,
} from "@/shared/types/ids";
import { createTransaction } from "./index";

/**
 * Receipt extraction pipeline (Wave 2 — Books headline feature). Uploads a receipt to
 * the vision model (Anthropic via the AI SDK; the mock provider returns canned data for
 * dev/test), stores the structured result on a `receipt_extractions` row, and publishes
 * `ReceiptProcessed` (the event is declared in the catalog + activity labels but had no
 * emitter before this). A human reviews the row in the `/books/receipts` queue and either
 * applies it (creates a `book_transactions` row) or rejects it.
 *
 * Bytes are pulled server-side from Supabase Storage (`downloadFileBytes`) and fed to the
 * model as a `FilePart` — the existing assistant route only handles text parts, so this is
 * the first image/file input path in the codebase. Credit metering is opt-in via
 * `RECEIPT_EXTRACTION_COST_CENTS` (default 0 = free); when > 0 this is the first production
 * caller of `consumeCredit`.
 */

/** Structured shape persisted on `receipt_extractions.extracted_data` (jsonb). */
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
  /** 0..1 — surfaced in the queue so low-confidence rows get human review. */
  confidence: number;
}

/** Zod schema the model is forced into via `generateObject` (structured output). */
const ReceiptExtractionSchema = z.object({
  merchant: z.string(),
  date: z.string(),
  totalCents: z.number().int(),
  taxCents: z.number().int().default(0),
  currency: z.string().default("AUD"),
  category: z.string(),
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number().default(1),
        unitPriceCents: z.number().int(),
        amountCents: z.number().int(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
});

const EXTRACTION_PROMPT = `You are a receipt extraction assistant for a small-business accounting tool.
Analyse the attached receipt image or PDF and extract its details as JSON.

- totalCents: the grand total the customer paid, in integer cents (e.g. $12.99 → 1299).
- taxCents: the GST/tax portion of the total, in integer cents (0 if none shown).
- currency: ISO 4-letter code if shown, else "AUD".
- category: the single best-fit expense category slug from this list ONLY:
    rent, utilities, supplies, travel, wages, software_expense, vehicle_expense, other_expense
- date: the receipt date as an ISO "YYYY-MM-DD" string; if only partial/ambiguous, use the most likely date.
- lineItems: individual line items (empty array if not itemised); amountCents = round(quantity * unitPriceCents).
- confidence: your confidence in the extraction, 0.0 to 1.0 (low for blurry/ambiguous receipts).

Return ONLY the JSON object matching the schema.`;

/** Canned extraction for the mock provider (no API key needed — dev/test path). */
function mockExtractedData(now: Date): ExtractedReceiptData {
  const iso = now.toISOString().slice(0, 10);
  return {
    merchant: "Mock Merchant",
    date: iso,
    totalCents: 1099,
    taxCents: 100,
    currency: "AUD",
    category: "supplies",
    lineItems: [{ description: "Mock item", quantity: 1, unitPriceCents: 999, amountCents: 999 }],
    confidence: 0.95,
  };
}

export interface ExtractionRow {
  id: ReceiptExtractionId;
  workspaceId: WorkspaceId;
  fileId: FileId;
  status: "pending" | "reviewed" | "applied" | "rejected";
  extractedData: ExtractedReceiptData | null;
  transactionId: BookTransactionId | null;
  errorMessage: string | null;
  modelUsed: string;
  createdAt: Date;
  updatedAt: Date;
}

function coerceExtractedData(raw: unknown): ExtractedReceiptData {
  // The schema-validated object from generateObject; the jsonb round-trip may loosen
  // types, so re-coerce defensively for callers (UI/apply).
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    merchant: String(r.merchant ?? ""),
    date: String(r.date ?? ""),
    totalCents: Math.round(Number(r.totalCents ?? 0)) || 0,
    taxCents: Math.round(Number(r.taxCents ?? 0)) || 0,
    currency: String(r.currency ?? "AUD"),
    category: String(r.category ?? "other_expense"),
    lineItems: Array.isArray(r.lineItems)
      ? (r.lineItems as Array<Record<string, unknown>>).map((li) => ({
          description: String(li.description ?? ""),
          quantity: Number(li.quantity ?? 1) || 1,
          unitPriceCents: Math.round(Number(li.unitPriceCents ?? 0)) || 0,
          amountCents: Math.round(Number(li.amountCents ?? 0)) || 0,
        }))
      : [],
    confidence: Math.min(1, Math.max(0, Number(r.confidence ?? 0))) || 0,
  };
}

/**
 * Run extraction for a receipt file. Fetches the file (IDOR-safe), optionally consumes a
 * credit, downloads the bytes, calls the vision model (or the mock), persists the result,
 * and publishes `ReceiptProcessed`. Returns the new extraction id. Throws on missing file
 * or insufficient credit (caller surfaces the error).
 */
export async function extractReceipt(
  workspaceId: WorkspaceId,
  fileId: FileId,
  actorId: UserId,
): Promise<ReceiptExtractionId> {
  const file = await getFile(workspaceId, fileId);
  if (!file) throw new Error("Receipt file not found in this workspace.");

  const costCents = env.RECEIPT_EXTRACTION_COST_CENTS;
  if (costCents > 0) {
    // First production caller of consumeCredit. Throws InsufficientCreditError on a low
    // balance — let it propagate so the action can surface "insufficient credit".
    await consumeCredit(
      workspaceId,
      {
        amountCents: costCents,
        reason: "receipt_extraction",
        moduleKey: "books",
        metadata: { fileId },
      },
      actorId,
    );
  }

  const modelUsed = isMockProvider() ? "mock" : env.AI_PROVIDER;
  let extracted: ExtractedReceiptData;
  let errorMessage: string | null = null;

  try {
    if (isMockProvider()) {
      extracted = mockExtractedData(new Date());
    } else {
      const { bytes } = await downloadFileBytes(file.storagePath);
      const { object } = await generateObject({
        model: getAIModel(),
        schema: ReceiptExtractionSchema,
        messages: [
          {
            role: "user",
            content: [
              { type: "file", data: bytes, mediaType: file.mimeType, filename: file.fileName },
              { type: "text", text: EXTRACTION_PROMPT },
            ],
          },
        ],
      });
      extracted = coerceExtractedData(object);
    }
  } catch (err) {
    // Persist the failure as a rejected row so it's visible in the queue rather than
    // silently dropped. No extractedData; the user can still manually enter the tx.
    errorMessage = err instanceof Error ? err.message : String(err);
    extracted = coerceExtractedData({});
  }

  const db = getDb();
  const rows = await db
    .insert(receiptExtractions)
    .values({
      workspaceId,
      fileId,
      status: errorMessage ? "rejected" : "pending",
      extractedData: errorMessage ? null : (extracted as unknown as Record<string, unknown>),
      errorMessage,
      modelUsed,
      actorUserId: actorId,
    })
    .returning({ id: receiptExtractions.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create receipt extraction.");

  await publishEvent({
    type: "ReceiptProcessed",
    workspaceId,
    actorUserId: actorId,
    entityType: "receipt_extraction",
    entityId: row.id,
    metadata: {
      fileId,
      status: errorMessage ? "rejected" : "pending",
      merchant: extracted.merchant,
      totalCents: extracted.totalCents,
      confidence: extracted.confidence,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "books.receipt.extract",
    targetType: "receipt_extraction",
    targetId: row.id,
    metadata: { fileId, modelUsed, status: errorMessage ? "rejected" : "pending" },
  });
  return row.id;
}

/** Overrides a human reviewer applies on top of the extracted data before creating a tx. */
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

/**
 * Apply an extraction: create a `book_transactions` row from the extracted data (with
 * reviewer overrides), set the extraction `status = 'applied'` + `transactionId`, audit.
 * Throws if the extraction isn't found, isn't pending/reviewed, or has no extractedData.
 */
export async function applyExtraction(
  workspaceId: WorkspaceId,
  extractionId: ReceiptExtractionId,
  patch: ApplyExtractionPatch,
  actorId: UserId,
): Promise<BookTransactionId> {
  const db = getDb();
  const rows = await db
    .select()
    .from(receiptExtractions)
    .where(
      and(eq(receiptExtractions.id, extractionId), eq(receiptExtractions.workspaceId, workspaceId)),
    )
    .limit(1);
  const ext = rows[0];
  if (!ext) throw new Error("Receipt extraction not found.");
  if (ext.status === "applied") throw new Error("Receipt extraction already applied.");
  if (!ext.extractedData) throw new Error("Receipt extraction has no extracted data.");

  const data = coerceExtractedData(ext.extractedData);
  const type = patch.type ?? "expense";
  const amountCents = patch.amountCents ?? data.totalCents;
  const gstCents = patch.gstCents ?? data.taxCents;
  const date = patch.date ?? safeDate(data.date) ?? new Date();
  const description = patch.description?.trim() || data.merchant || "Receipt";
  const category = patch.category ?? data.category;

  const transactionId = await createTransaction(
    workspaceId,
    {
      type,
      amountCents,
      gstCents,
      currency: patch.currency ?? data.currency,
      date,
      description,
      category,
      customerId: (patch.customerId as never) ?? null,
      notes: patch.notes ?? null,
      receiptFileId: ext.fileId,
    },
    actorId,
  );

  await db
    .update(receiptExtractions)
    .set({ status: "applied", transactionId, updatedAt: new Date() })
    .where(eq(receiptExtractions.id, extractionId));
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "books.receipt.apply",
    targetType: "receipt_extraction",
    targetId: extractionId,
    metadata: { transactionId, type, amountCents, category },
  });
  return transactionId;
}

/** Reject an extraction (discard without creating a transaction). */
export async function rejectExtraction(
  workspaceId: WorkspaceId,
  extractionId: ReceiptExtractionId,
  actorId: UserId,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .update(receiptExtractions)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(
      and(eq(receiptExtractions.id, extractionId), eq(receiptExtractions.workspaceId, workspaceId)),
    )
    .returning({ id: receiptExtractions.id });
  if (!rows[0]) throw new Error("Receipt extraction not found.");
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "books.receipt.reject",
    targetType: "receipt_extraction",
    targetId: extractionId,
    metadata: {},
  });
}

/** List extractions for the review queue, optionally filtered by status. */
export async function listExtractions(
  workspaceId: WorkspaceId,
  opts?: { status?: "pending" | "reviewed" | "applied" | "rejected"; limit?: number },
): Promise<ExtractionRow[]> {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 500);
  const conditions = [eq(receiptExtractions.workspaceId, workspaceId)];
  if (opts?.status) conditions.push(eq(receiptExtractions.status, opts.status));
  const rows = await db
    .select({
      id: receiptExtractions.id,
      workspaceId: receiptExtractions.workspaceId,
      fileId: receiptExtractions.fileId,
      status: receiptExtractions.status,
      extractedData: receiptExtractions.extractedData,
      transactionId: receiptExtractions.transactionId,
      errorMessage: receiptExtractions.errorMessage,
      modelUsed: receiptExtractions.modelUsed,
      createdAt: receiptExtractions.createdAt,
      updatedAt: receiptExtractions.updatedAt,
    })
    .from(receiptExtractions)
    .where(and(...conditions))
    .orderBy(desc(receiptExtractions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    extractedData: r.extractedData ? coerceExtractedData(r.extractedData) : null,
  })) as ExtractionRow[];
}

/** Fetch a single extraction, workspace-scoped (IDOR-safe). */
export async function getExtraction(
  workspaceId: WorkspaceId,
  extractionId: ReceiptExtractionId,
): Promise<ExtractionRow | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: receiptExtractions.id,
      workspaceId: receiptExtractions.workspaceId,
      fileId: receiptExtractions.fileId,
      status: receiptExtractions.status,
      extractedData: receiptExtractions.extractedData,
      transactionId: receiptExtractions.transactionId,
      errorMessage: receiptExtractions.errorMessage,
      modelUsed: receiptExtractions.modelUsed,
      createdAt: receiptExtractions.createdAt,
      updatedAt: receiptExtractions.updatedAt,
    })
    .from(receiptExtractions)
    .where(
      and(eq(receiptExtractions.id, extractionId), eq(receiptExtractions.workspaceId, workspaceId)),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    extractedData: r.extractedData ? coerceExtractedData(r.extractedData) : null,
  } as ExtractionRow;
}

/** Parse an ISO date string defensively — returns null if invalid. */
function safeDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
