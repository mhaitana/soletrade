import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/server/application/auth/workspace-context";
import { authorizeOrAudit } from "@/server/application/auth/authorization/index";
import { isModuleEnabled } from "@/server/foundation/module-installations/index";
import { getWorkspace } from "@/server/foundation/workspaces/index";
import { listTransactions } from "@/server/domains/books/index";
import { categoryLabel } from "@/config/books-categories";
import { parsePeriod, periodRange, type Period } from "@/utils/periods";
import { toCsv, type CsvColumn } from "@/utils/csv";

/**
 * Books transactions CSV export (Wave 4). Streams `text/csv` for `?type=income|expense|all&period=`.
 * Mirrors the Drive CSV export route (`src/app/api/drive/export/route.ts`). Auth: resolved
 * workspace context (401), `manage:books` (403), books module installed (404).
 */

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
  // Reanchor the "year"/"quarter" window to the workspace's financial year (matches the page).
  const workspace = await getWorkspace(ctx.workspaceId).catch(() => null);
  const range = periodRange(period, undefined, workspace?.fyStartMonth ?? 7);

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
