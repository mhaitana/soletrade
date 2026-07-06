import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/platform/context";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import { listTransactions } from "@/modules/books";
import { categoryLabel } from "@/shared/constants/books-categories";
import { parsePeriod, periodRange, type Period } from "@/shared/utils/periods";
import { toCsv, type CsvColumn } from "@/shared/utils/csv";

/**
 * Books transactions CSV export (Wave 4). Streams `text/csv` for `?type=income|expense|all&period=`.
 * Mirrors the Drive CSV export route (`src/app/api/drive/export/route.ts`). Auth: resolved
 * workspace context (401), `manage:books` (403), books module installed (404).
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["income", "expense", "all"]).default("all"),
  period: z.string().optional(),
});

const COLUMNS: readonly CsvColumn[] = [
  { key: "date", header: "Date" },
  { key: "type", header: "Type" },
  { key: "category", header: "Category" },
  { key: "description", header: "Description" },
  { key: "customer", header: "Customer" },
  { key: "amount", header: "Amount" },
  { key: "gst", header: "GST" },
  { key: "currency", header: "Currency" },
  { key: "notes", header: "Notes" },
];

/** Integer cents → plain decimal dollars string (no thousands separator, CSV-safe). */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export async function GET(request: Request): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "manage:books")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!(await isModuleEnabled(ctx.workspaceId, "books"))) {
    return NextResponse.json({ error: "Books module not installed." }, { status: 404 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    type: url.searchParams.get("type") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const period: Period = parsePeriod(parsed.data.period);
  const range = periodRange(period);

  const rows = await listTransactions(ctx.workspaceId, {
    type: parsed.data.type === "all" ? undefined : parsed.data.type,
    dateFrom: range.start ?? undefined,
    dateTo: range.end,
    limit: 2000,
  });

  const csvRows: Record<string, unknown>[] = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    type: r.type,
    category: categoryLabel(r.type, r.category) ?? r.category,
    description: r.description,
    customer: r.customerName ?? "",
    amount: dollars(r.amountCents),
    gst: dollars(r.gstCents),
    currency: r.currency,
    notes: r.notes ?? "",
  }));
  const csv = toCsv(csvRows, COLUMNS);

  const today = new Date().toISOString().slice(0, 10);
  const filename = `books-transactions-${today}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
