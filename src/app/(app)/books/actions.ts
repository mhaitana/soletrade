"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import { listCustomers, type CustomerRow } from "@/platform/customers";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
  type TransactionInput,
  type TransactionRow,
} from "@/modules/books";
import { summarizeTransactions, type TransactionSummary } from "@/modules/books/calc";
import { type Period, parsePeriod, periodRange } from "@/shared/utils/periods";
import { isBookCategory } from "@/shared/constants/books-categories";
import type { BookType } from "@/server/db/schema/enums";
import { branded } from "@/shared/types/ids";

const forbid = (msg = "You don't have permission to manage books.") => ({
  ok: false as const,
  error: msg,
});

const createSchema = z
  .object({
    type: z.enum(["income", "expense"]),
    amountCents: z.number().int().min(1, "Amount must be greater than 0."),
    currency: z.string().trim().min(3).max(3).optional(),
    date: z.coerce.date(),
    description: z.string().trim().min(1, "Description is required.").max(280),
    category: z.string().trim().min(1, "Category is required."),
    customerId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    receiptFileId: z.string().uuid().nullable().optional(),
    /** GST portion in cents (Wave 2). 0 for non-GST transactions. Defaults to 0. */
    gstCents: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine((v) => isBookCategory(v.type, v.category), {
    message: "Pick a category for this transaction type.",
    path: ["category"],
  });

export type CreateTransactionResult =
  | { ok: true; transactionId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createTransactionAction(input: unknown): Promise<CreateTransactionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();

  const d = parsed.data;
  const txInput: TransactionInput = {
    type: d.type as BookType,
    amountCents: d.amountCents,
    currency: d.currency ?? "AUD",
    date: d.date,
    description: d.description,
    category: d.category,
    customerId: d.customerId ? branded<"CustomerId">(d.customerId) : null,
    notes: d.notes ?? null,
    receiptFileId: d.receiptFileId ? branded<"FileId">(d.receiptFileId) : null,
    gstCents: d.gstCents ?? 0,
  };

  try {
    const id = await createTransaction(ctx.workspaceId, txInput, ctx.user.id);
    revalidatePath("/books");
    return { ok: true, transactionId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create transaction.";
    return { ok: false, error: message };
  }
}

const updateSchema = z
  .object({
    transactionId: z.string().uuid(),
    type: z.enum(["income", "expense"]),
    amountCents: z.number().int().min(1, "Amount must be greater than 0."),
    currency: z.string().trim().min(3).max(3).optional(),
    date: z.coerce.date(),
    description: z.string().trim().min(1, "Description is required.").max(280),
    category: z.string().trim().min(1, "Category is required."),
    customerId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    receiptFileId: z.string().uuid().nullable().optional(),
    /** GST portion in cents (Wave 2). 0 for non-GST transactions. Defaults to 0. */
    gstCents: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .refine((v) => isBookCategory(v.type, v.category), {
    message: "Pick a category for this transaction type.",
    path: ["category"],
  });

export type UpdateTransactionResult =
  { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function updateTransactionAction(input: unknown): Promise<UpdateTransactionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();

  const { transactionId, ...rest } = parsed.data;
  try {
    await updateTransaction(
      ctx.workspaceId,
      branded<"BookTransactionId">(transactionId),
      {
        type: rest.type as BookType,
        amountCents: rest.amountCents,
        currency: rest.currency ?? "AUD",
        date: rest.date,
        description: rest.description,
        category: rest.category,
        customerId: rest.customerId ? branded<"CustomerId">(rest.customerId) : null,
        notes: rest.notes ?? null,
        receiptFileId: rest.receiptFileId
          ? branded<"FileId">(rest.receiptFileId)
          : rest.receiptFileId === null
            ? null
            : undefined,
        gstCents: rest.gstCents ?? 0,
      },
      ctx.user.id,
    );
    revalidatePath("/books");
    revalidatePath(`/books/${transactionId}`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update transaction.";
    return { ok: false, error: message };
  }
}

const idSchema = z.object({ transactionId: z.string().uuid() });

export type TransactionActionResult = { ok: true } | { ok: false; error: string };

export async function deleteTransactionAction(input: unknown): Promise<TransactionActionResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid transaction." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) return forbid();
  try {
    await deleteTransaction(
      ctx.workspaceId,
      branded<"BookTransactionId">(parsed.data.transactionId),
      ctx.user.id,
    );
    revalidatePath("/books");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete transaction.",
    };
  }
}

// --- Loaders (view:books ok for any role that can view) --------------------

// `periodRange` is imported from `@/shared/utils/periods` (extracted in Phase 9).

export type BooksPageData =
  | {
      installed: true;
      transactions: TransactionRow[];
      canManage: boolean;
      typeFilter: BookType | null;
      search: string;
      period: Period;
      summary: TransactionSummary;
    }
  | { installed: false };

export async function loadBooksPage(params?: {
  type?: BookType;
  search?: string;
  period?: Period;
}): Promise<BooksPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) return { installed: false };

  const period = params?.period ?? parsePeriod(undefined);
  const search = params?.search?.trim() ?? "";
  const range = periodRange(period);
  const [transactions, summaryRows, canManage] = await Promise.all([
    // Page list: cap at the default 100, with the type + search + date range.
    listTransactions(ctx.workspaceId, {
      type: params?.type,
      search: search || undefined,
      dateFrom: range.start ?? undefined,
      dateTo: range.end,
      limit: 100,
    }),
    // Summary: type + date range (NO search — the header is the period overview), full
    // period fetch capped at 2000. Aggregated in JS by the pure `summarizeTransactions`.
    listTransactions(ctx.workspaceId, {
      type: params?.type,
      dateFrom: range.start ?? undefined,
      dateTo: range.end,
      limit: 2000,
    }),
    Promise.resolve(authorize(ctx.role, "manage:books").ok),
  ]);
  const summary = summarizeTransactions(
    summaryRows.map((t) => ({
      type: t.type,
      amountCents: t.amountCents,
      date: t.date,
      category: t.category,
    })),
  );
  return {
    installed: true,
    transactions,
    canManage,
    typeFilter: params?.type ?? null,
    search,
    period,
    summary,
  };
}

export type BookDetailData =
  | { installed: true; transaction: TransactionRow | null; canManage: boolean }
  | { installed: false };

export async function loadTransaction(transactionId: string): Promise<BookDetailData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) return { installed: false };

  const [transaction, canManage] = await Promise.all([
    getTransaction(ctx.workspaceId, branded<"BookTransactionId">(transactionId)),
    Promise.resolve(authorize(ctx.role, "manage:books").ok),
  ]);
  return { installed: true, transaction, canManage };
}

export type BookEditData =
  | {
      installed: true;
      transaction: TransactionRow | null;
      customers: CustomerRow[];
      canManage: boolean;
    }
  | { installed: false };

export async function loadTransactionForEdit(transactionId: string): Promise<BookEditData> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) return { installed: false };

  const [transaction, customers, canManage] = await Promise.all([
    getTransaction(ctx.workspaceId, branded<"BookTransactionId">(transactionId)),
    listCustomers(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:books").ok),
  ]);
  return { installed: true, transaction, customers, canManage };
}

/** Customer list for the new-transaction form (module-gated). */
export async function loadCustomersForBook(): Promise<
  { installed: true; customers: CustomerRow[]; canManage: boolean } | { installed: false }
> {
  const ctx = await requireWorkspaceContext();
  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) return { installed: false };
  const [customers, canManage] = await Promise.all([
    listCustomers(ctx.workspaceId),
    Promise.resolve(authorize(ctx.role, "manage:books").ok),
  ]);
  return { installed: true, customers, canManage };
}
