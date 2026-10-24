"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorize } from "@/lib/domain/permissions/index";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { isModuleEnabled } from "@/server/foundation/module-installations/index";
import {
  applyExtraction,
  extractReceipt,
  listExtractions,
  rejectExtraction,
} from "@/server/domains/books/receipt-extraction";
import type { ExtractionRow } from "@/lib/domain/books/receipt-extraction-types";
import { branded } from "@/types/ids";
import { DOCUMENT_PAGE_SIZE, parsePage } from "@/utils/pagination";

const forbid = (msg = "You don't have permission to manage books.") => ({
  ok: false as const,
  error: msg,
});

export type ExtractionStatus = "pending" | "reviewed" | "applied" | "rejected";

// --- Loader -----------------------------------------------------------------

export type ReceiptsPageData =
  | {
      installed: true;
      extractions: ExtractionRow[];
      canManage: boolean;
      statusFilter: ExtractionStatus | null;
      page: number;
      hasNext: boolean;
    }
  | { installed: false };

/**
 * Load the receipt review queue. The queue is a manage:books surface - a viewer
 * without `manage:books` gets `canManage: false` and an empty list (the page renders
 * a permission message). Mirrors `loadBooksPage`'s module-gate + canManage pattern.
 */
export async function loadReceiptsPage(params?: {
  status?: ExtractionStatus;
  page?: number;
}): Promise<ReceiptsPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) return { installed: false };

  const canManage = authorize(ctx.role, "manage:books").ok;
  const statusFilter = params?.status ?? null;
  const page = parsePage(params?.page);
  // Only fetch extractions for managers - viewers can't act on them anyway and the
  // page renders a permission message, so a DB hit would be wasted.
  const extractions = canManage
    ? await listExtractions(ctx.workspaceId, {
        status: params?.status,
        limit: DOCUMENT_PAGE_SIZE + 1,
        offset: (page - 1) * DOCUMENT_PAGE_SIZE,
      })
    : [];
  return {
    installed: true,
    extractions: extractions.slice(0, DOCUMENT_PAGE_SIZE),
    canManage,
    statusFilter,
    page,
    hasNext: extractions.length > DOCUMENT_PAGE_SIZE,
  };
}

// --- Actions ----------------------------------------------------------------

const extractSchema = z.object({ fileId: z.string().uuid() });

export type ExtractReceiptResult =
  { ok: true; extractionId: string } | { ok: false; error: string };

export async function extractReceiptAction(input: unknown): Promise<ExtractReceiptResult> {
  const parsed = extractSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid file." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();

  try {
    const id = await extractReceipt(
      ctx.workspaceId,
      branded<"FileId">(parsed.data.fileId),
      ctx.user.id,
    );
    revalidatePath("/books/receipts");
    return { ok: true, extractionId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to extract receipt.";
    return { ok: false, error: message };
  }
}

const applySchema = z.object({
  extractionId: z.string().uuid(),
  type: z.enum(["income", "expense"]).optional(),
  amountCents: z.number().int().min(1).optional(),
  gstCents: z.number().int().min(0).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  date: z.coerce.date().optional(),
  description: z.string().trim().min(1).max(280).optional(),
  category: z.string().trim().min(1).max(50).optional(),
  customerId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type ApplyExtractionResult =
  | { ok: true; transactionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function applyExtractionAction(input: unknown): Promise<ApplyExtractionResult> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();

  const { extractionId, ...patch } = parsed.data;
  try {
    const txId = await applyExtraction(
      ctx.workspaceId,
      branded<"ReceiptExtractionId">(extractionId),
      patch,
      ctx.user.id,
    );
    revalidatePath("/books/receipts");
    return { ok: true, transactionId: txId };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to apply extraction.";
    return { ok: false, error: message };
  }
}

const rejectSchema = z.object({ extractionId: z.string().uuid() });

export type RejectExtractionResult = { ok: true } | { ok: false; error: string };

export async function rejectExtractionAction(input: unknown): Promise<RejectExtractionResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid extraction." };

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();

  try {
    await rejectExtraction(
      ctx.workspaceId,
      branded<"ReceiptExtractionId">(parsed.data.extractionId),
      ctx.user.id,
    );
    revalidatePath("/books/receipts");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reject extraction.",
    };
  }
}
