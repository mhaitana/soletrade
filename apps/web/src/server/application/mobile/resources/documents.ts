import "server-only";
import { z } from "zod";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { renderPdf, pdfResponse } from "@/server/infrastructure/pdf/index";
import { InvoiceDocument } from "@/server/domains/invoices/documents/invoice-document";
import { QuoteDocument } from "@/server/domains/quotes/documents/quote-document";
import { BooksPlDocument } from "@/server/domains/books/documents/books-pl-document";
import { resolveInvoicePaymentMethods } from "@/types/payment-methods";
import { summarizeTransactions } from "@/lib/domain/books/calc";
import type { InvoiceWithItems } from "@/lib/domain/invoices/types";
import type { QuoteWithItems } from "@/lib/domain/quotes/types";
import * as drive from "@/server/domains/drive/index";
import { toCsv, type CsvColumn } from "@/utils/csv";
import { categoryLabel } from "@/config/books-categories";
import { platformLabel } from "@/config/drive-platforms";
import { periodRange } from "@/utils/periods";
import { allTransactions } from "@/server/application/mobile/resources/book-transactions";
import { parse, type Context, type Query } from "@/server/application/mobile/resources/common";
export async function salesPdf(
  ctx: Context,
  invoice: boolean,
  row: InvoiceWithItems | QuoteWithItems,
) {
  const workspace = await getWorkspace(ctx.workspaceId);
  const element = invoice
    ? InvoiceDocument({
        invoice: {
          ...(row as InvoiceWithItems),
          paymentMethods: resolveInvoicePaymentMethods(
            (row as InvoiceWithItems).paymentMethods,
            workspace?.paymentMethods ?? null,
          ),
        },
        workspaceName: workspace?.name ?? null,
      })
    : QuoteDocument({ quote: row as QuoteWithItems, workspaceName: workspace?.name ?? null });
  return pdfResponse(await renderPdf(element), `${row.number}.pdf`);
}
async function range(ctx: Context, q: Query) {
  const workspace = await getWorkspace(ctx.workspaceId);
  const r = periodRange(q.period ?? "year", undefined, workspace?.fyStartMonth ?? 7);
  return { workspace, dateFrom: q.dateFrom ?? r.start ?? undefined, dateTo: q.dateTo ?? r.end };
}
export async function booksPdf(ctx: Context, q: Query) {
  const r = await range(ctx, q);
  const rows = await allTransactions(ctx, r);
  const summary = summarizeTransactions(rows);
  return pdfResponse(
    await renderPdf(
      BooksPlDocument({
        summary,
        workspace: r.workspace,
        periodLabel: `${r.dateFrom?.toISOString().slice(0, 10) ?? "All time"} – ${r.dateTo.toISOString().slice(0, 10)}`,
      }),
    ),
    "books-pl-report.pdf",
  );
}
const dollars = (value: number) => (value / 100).toFixed(2);
function csvResponse(
  rows: Record<string, unknown>[],
  columns: readonly CsvColumn[],
  filename: string,
) {
  return new Response(toCsv(rows, columns), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}.csv"`,
      "cache-control": "no-store",
    },
  });
}
export async function booksCsv(ctx: Context, q: Query) {
  const r = await range(ctx, q);
  const rows = await allTransactions(ctx, {
    ...r,
    type: q.type && q.type !== "all" ? parse(z.enum(["income", "expense"]), q.type) : undefined,
  });
  return csvResponse(
    rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      type: r.type,
      category: categoryLabel(r.type, r.category) ?? r.category,
      description: r.description,
      customer: r.customerName ?? "",
      amount: dollars(r.amountCents),
      gst: dollars(r.gstCents),
      currency: r.currency,
      notes: r.notes ?? "",
    })),
    [
      { key: "date", header: "Date" },
      { key: "type", header: "Type" },
      { key: "category", header: "Category" },
      { key: "description", header: "Description" },
      { key: "customer", header: "Customer" },
      { key: "amount", header: "Amount" },
      { key: "gst", header: "GST" },
      { key: "currency", header: "Currency" },
      { key: "notes", header: "Notes" },
    ],
    "books-transactions",
  );
}
export async function driveCsv(ctx: Context, q: Query) {
  const type = parse(z.enum(["earnings", "trips", "expenses"]), q.type ?? "earnings");
  const r = await range(ctx, q);
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const opts = { dateFrom: r.dateFrom, dateTo: r.dateTo, offset, limit: 500 };
    const batch =
      type === "earnings"
        ? await drive.listEarnings(ctx.workspaceId, opts)
        : type === "trips"
          ? await drive.listTrips(ctx.workspaceId, opts)
          : await drive.listExpenses(ctx.workspaceId, opts);
    rows.push(
      ...batch.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        ...("platform" in r ? { platform: platformLabel(r.platform) ?? r.platform } : {}),
        ...("amountCents" in r
          ? { amount: dollars(r.amountCents), currency: r.currency, description: r.description }
          : { distanceKm: (r.distanceMeters / 1000).toFixed(2), purpose: r.purpose ?? "" }),
        ...("odometerKm" in r ? { type: r.type, odometerKm: r.odometerKm ?? "" } : {}),
        notes: r.notes ?? "",
      })),
    );
    if (batch.length < 500) break;
  }
  const columns: CsvColumn[] = [
    { key: "date", header: "Date" },
    ...(type === "earnings" || type === "trips"
      ? [{ key: "platform", header: "Platform" }]
      : [{ key: "type", header: "Type" }]),
    ...(type === "trips"
      ? [
          { key: "distanceKm", header: "Distance (km)" },
          { key: "purpose", header: "Purpose" },
        ]
      : [
          { key: "description", header: "Description" },
          { key: "amount", header: "Amount" },
          { key: "currency", header: "Currency" },
        ]),
    ...(type === "expenses" ? [{ key: "odometerKm", header: "Odometer (km)" }] : []),
    { key: "notes", header: "Notes" },
  ];
  return csvResponse(rows, columns, `drive-${type}`);
}
