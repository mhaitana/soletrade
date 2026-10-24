import { z } from "zod";
import { isBookCategory } from "@/shared/constants/books-categories";
import { MobileApiError } from "@/platform/mobile/http";
import { branded } from "@/shared/types/ids";
import * as books from "@/modules/books";
import * as receipts from "@/modules/books/receipt-extraction";
import { currentQuarter, listTaxPeriods, lodgeTaxPeriod } from "@/modules/books/tax";
import { summarizeGst } from "@/modules/books/calc";
import { getWorkspace } from "@/platform/workspaces";
import { getFile } from "@/platform/files";
import { getDataClient } from "@/server/db/client";
import { unwrapVoid } from "@/server/db/helpers";
import {
  cents,
  checkVersion,
  conflict,
  createOnce,
  currency,
  date,
  found,
  gate,
  id,
  missing,
  notes,
  offset,
  page,
  parse,
  splitBody,
  text,
  type Context,
  type Method,
  type Query,
} from "./common";
const bookType = z.enum(["income", "expense"]);
export const transactionSchema = z
  .object({
    type: bookType,
    amountCents: cents.positive(),
    gstCents: cents.optional(),
    currency,
    date,
    description: text,
    category: z.string().trim().min(1).max(50),
    customerId: z.uuid().nullable().optional(),
    receiptFileId: z.uuid().nullable().optional(),
    notes,
  })
  .strict();
const extractionStatus = z.enum(["pending", "reviewed", "applied", "rejected"]);
async function receiptFile(ctx: Context, value?: string | null) {
  if (value) {
    await gate(ctx, "view:file");
    found(await getFile(ctx.workspaceId, branded<"FileId">(value)));
    await (await import("./files")).assertFileComplete(ctx, value);
  }
}
export async function allTransactions(
  ctx: Context,
  opts: { dateFrom?: Date; dateTo?: Date; type?: "income" | "expense" } = {},
) {
  const rows: books.TransactionRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const batch = await books.listTransactions(ctx.workspaceId, { ...opts, offset, limit: 500 });
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
export async function readBooks(ctx: Context, p: string[], q: Query): Promise<unknown | Response> {
  await gate(ctx, p[0] === "export" ? "manage:books" : "view:books", "books");
  if (p.length === 1) {
    switch (p[0]) {
      case "transactions":
        return page(
          await books.listTransactions(ctx.workspaceId, {
            search: q.search,
            category: q.category,
            type: q.type ? parse(bookType, q.type) : undefined,
            customerId: q.customerId ? branded<"CustomerId">(q.customerId) : undefined,
            dateFrom: q.dateFrom,
            dateTo: q.dateTo,
            limit: q.limit + 1,
            offset: offset(q),
          }),
          q,
        );
      case "summary":
        return books.getBookSummary(ctx.workspaceId, {
          type: q.type ? parse(bookType, q.type) : undefined,
          dateFrom: q.dateFrom,
          dateTo: q.dateTo,
        });
      case "receipts":
        return page(
          await receipts.listExtractions(ctx.workspaceId, {
            status: q.status ? parse(extractionStatus, q.status) : undefined,
            limit: q.limit + 1,
            offset: offset(q),
          }),
          q,
        );
      case "tax": {
        const workspace = found(await getWorkspace(ctx.workspaceId));
        const [rows, lodgedPeriods] = await Promise.all([
          allTransactions(ctx),
          listTaxPeriods(ctx.workspaceId),
        ]);
        return {
          gstSummary: summarizeGst(rows, workspace.fyStartMonth),
          lodgedPeriods,
          currentQuarter: currentQuarter(new Date(), workspace.fyStartMonth),
          currency: workspace.defaultCurrency,
        };
      }
      case "report":
        return (await import("./documents")).booksPdf(ctx, q);
      case "export":
        return (await import("./documents")).booksCsv(ctx, q);
    }
  }
  if (p.length === 2) {
    if (p[0] === "transactions")
      return found(
        await books.getTransaction(ctx.workspaceId, branded<"BookTransactionId">(id(p[1]))),
      );
    if (p[0] === "receipts")
      return found(
        await receipts.getExtraction(ctx.workspaceId, branded<"ReceiptExtractionId">(id(p[1]))),
      );
  }
  missing();
}
export async function writeBooks(
  ctx: Context,
  p: string[],
  method: Method,
  body: unknown,
): Promise<unknown> {
  await gate(ctx, "manage:books", "books");
  const { data, expectedVersion } = splitBody(body);
  if (p.length === 2 && p[0] === "tax" && p[1] === "lodge" && method === "POST") {
    const input = parse(
      z
        .object({
          fiscalYear: z.number().int().min(2000).max(2100),
          quarter: z.number().int().min(1).max(4),
        })
        .strict(),
      data,
    );
    return lodgeTaxPeriod(
      ctx.workspaceId,
      input.fiscalYear,
      input.quarter,
      ctx.user.id,
      (await getWorkspace(ctx.workspaceId))?.fyStartMonth ?? 7,
    );
  }
  if (p.length === 1 && p[0] === "transactions" && method === "POST") {
    const input = parse(transactionSchema, data);
    if (!isBookCategory(input.type, input.category))
      throw new MobileApiError(
        "invalid_request",
        "Unknown transaction category for this type.",
        400,
      );
    if ((input.gstCents ?? 0) > input.amountCents)
      conflict("GST cannot exceed the transaction amount.");
    await receiptFile(ctx, input.receiptFileId);
    return createOnce(
      ctx,
      (v) => books.getTransaction(ctx.workspaceId, branded<"BookTransactionId">(v)),
      (v) =>
        books.createTransaction(
          ctx.workspaceId,
          {
            ...input,
            customerId: input.customerId
              ? branded<"CustomerId">(input.customerId)
              : input.customerId === null
                ? null
                : undefined,
            receiptFileId: input.receiptFileId
              ? branded<"FileId">(input.receiptFileId)
              : input.receiptFileId === null
                ? null
                : undefined,
          },
          ctx.user.id,
          v ? branded<"BookTransactionId">(v) : undefined,
        ),
    );
  }
  if (p.length === 2 && p[0] === "transactions") {
    const key = branded<"BookTransactionId">(id(p[1]));
    const row = found(await books.getTransaction(ctx.workspaceId, key));
    checkVersion(row, expectedVersion);
    if (row.sourceInvoiceId || row.sourceEarningId || row.sourceExpenseId || row.sourceTripId)
      conflict("Edit this record in its source module.");
    if (method === "DELETE") {
      parse(z.object({}).strict(), data);
      if (!(await books.deleteTransaction(ctx.workspaceId, key, ctx.user.id))) missing();
      return { deleted: true };
    }
    if (method === "PATCH") {
      const input = parse(transactionSchema.partial(), data);
      if (!isBookCategory(input.type ?? row.type, input.category ?? row.category))
        throw new MobileApiError(
          "invalid_request",
          "Unknown transaction category for this type.",
          400,
        );
      if ((input.gstCents ?? row.gstCents) > (input.amountCents ?? row.amountCents))
        conflict("GST cannot exceed the transaction amount.");
      await receiptFile(ctx, input.receiptFileId);
      await books.updateTransaction(
        ctx.workspaceId,
        key,
        {
          ...input,
          customerId: input.customerId
            ? branded<"CustomerId">(input.customerId)
            : input.customerId === null
              ? null
              : undefined,
          receiptFileId: input.receiptFileId
            ? branded<"FileId">(input.receiptFileId)
            : input.receiptFileId === null
              ? null
              : undefined,
        },
        ctx.user.id,
        undefined,
        expectedVersion,
      );
      return found(await books.getTransaction(ctx.workspaceId, key));
    }
  }
  if (p.length === 2 && p[0] === "receipts" && p[1] === "extract" && method === "POST") {
    const input = parse(z.object({ fileId: z.uuid() }).strict(), data);
    await receiptFile(ctx, input.fileId);
    const extractionId = await receipts.extractReceipt(
      ctx.workspaceId,
      branded<"FileId">(input.fileId),
      ctx.user.id,
      ctx.operationId ? branded<"ReceiptExtractionId">(id(ctx.operationId)) : undefined,
    );
    return found(await receipts.getExtraction(ctx.workspaceId, extractionId));
  }
  if (p.length === 3 && p[0] === "receipts" && method === "POST") {
    const key = branded<"ReceiptExtractionId">(id(p[1]));
    const row = found(await receipts.getExtraction(ctx.workspaceId, key));
    checkVersion(row, expectedVersion);
    if (row.processing) conflict("Receipt OCR is still processing.");
    if (p[2] === "apply") {
      const input = parse(transactionSchema.omit({ receiptFileId: true }).partial(), data);
      if (row.status === "applied" && row.transactionId)
        return { transactionId: row.transactionId };
      if (row.status !== "pending" && row.status !== "reviewed")
        conflict("Only pending receipts can be applied.");
      return {
        transactionId: await receipts.applyExtraction(ctx.workspaceId, key, input, ctx.user.id),
      };
    }
    if (p[2] === "reject") {
      parse(z.object({}).strict(), data);
      if (row.status === "applied") conflict("Applied receipts cannot be rejected.");
      await receipts.rejectExtraction(ctx.workspaceId, key, ctx.user.id);
      return found(await receipts.getExtraction(ctx.workspaceId, key));
    }
    if (p[2] === "review") {
      parse(z.object({}).strict(), data);
      if (row.status !== "pending" && row.status !== "reviewed")
        conflict("Only pending receipts can be reviewed.");
      await unwrapVoid(
        getDataClient()
          .from("receipt_extractions")
          .update({ status: "reviewed", updated_at: new Date().toISOString() })
          .eq("workspace_id", ctx.workspaceId)
          .eq("id", key)
          .in("status", ["pending", "reviewed"]),
      );
      return found(await receipts.getExtraction(ctx.workspaceId, key));
    }
  }
  missing();
}
