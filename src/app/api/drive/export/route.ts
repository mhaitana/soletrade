import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/platform/context";
import { authorizeOrAudit } from "@/server/security";
import { isModuleEnabled } from "@/platform/module-installations";
import { getWorkspace } from "@/platform/workspaces";
import {
  listEarnings,
  listTrips,
  listExpenses,
  type EarningRow,
  type TripRow,
  type ExpenseRow,
} from "@/modules/drive";
import { platformLabel } from "@/shared/constants/drive-platforms";
import { parsePeriod, periodRange, type Period } from "@/shared/utils/periods";
import { toCsv, type CsvColumn } from "@/shared/utils/csv";

/**
 * Drive CSV export (Wave 2). Streams `text/csv` for `?type=earnings|trips|expenses&period=...`.
 * Route-handler precedent — Server Actions can't stream arbitrary bytes cleanly, so CSV export
 * goes via a GET route (future Books ledger / invoice exports can reuse `toCsv` + this pattern).
 *
 * Auth: resolved workspace context (401 if none). `manage:drive` gates the export. The session
 * workspace id is resolved server-side — the client never supplies it.
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(["earnings", "trips", "expenses"]).default("earnings"),
  period: z.string().optional(),
});

/** Integer cents → plain decimal dollars string (no thousands separator, CSV-safe). */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Integer meters → plain decimal km string. */
function km(meters: number): string {
  return (meters / 1000).toFixed(2);
}

const EARNING_COLUMNS: readonly CsvColumn[] = [
  { key: "date", header: "Date" },
  { key: "platform", header: "Platform" },
  { key: "description", header: "Description" },
  { key: "amount", header: "Amount" },
  { key: "currency", header: "Currency" },
  { key: "notes", header: "Notes" },
];

const TRIP_COLUMNS: readonly CsvColumn[] = [
  { key: "date", header: "Date" },
  { key: "platform", header: "Platform" },
  { key: "distanceKm", header: "Distance (km)" },
  { key: "purpose", header: "Purpose" },
  { key: "notes", header: "Notes" },
];

const EXPENSE_COLUMNS: readonly CsvColumn[] = [
  { key: "date", header: "Date" },
  { key: "type", header: "Type" },
  { key: "description", header: "Description" },
  { key: "amount", header: "Amount" },
  { key: "currency", header: "Currency" },
  { key: "odometerKm", header: "Odometer (km)" },
  { key: "notes", header: "Notes" },
];

function earningRows(rows: readonly EarningRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    platform: platformLabel(r.platform) ?? r.platform,
    description: r.description,
    amount: dollars(r.amountCents),
    currency: r.currency,
    notes: r.notes ?? "",
  }));
}

function tripRows(rows: readonly TripRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    platform: platformLabel(r.platform) ?? r.platform,
    distanceKm: km(r.distanceMeters),
    purpose: r.purpose ?? "",
    notes: r.notes ?? "",
  }));
}

function expenseRows(rows: readonly ExpenseRow[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    type: r.type,
    description: r.description,
    amount: dollars(r.amountCents),
    currency: r.currency,
    odometerKm: r.odometerKm == null ? "" : String(r.odometerKm),
    notes: r.notes ?? "",
  }));
}

export async function GET(request: Request): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "manage:drive")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!(await isModuleEnabled(ctx.workspaceId, "drive"))) {
    return NextResponse.json({ error: "Drive module not installed." }, { status: 404 });
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

  let csv: string;
  let fileSlug: string;
  if (parsed.data.type === "earnings") {
    const rows = await listEarnings(ctx.workspaceId, {
      dateFrom: range.start ?? undefined,
      dateTo: range.end,
      limit: 2000,
    });
    csv = toCsv(earningRows(rows), EARNING_COLUMNS);
    fileSlug = "earnings";
  } else if (parsed.data.type === "trips") {
    const rows = await listTrips(ctx.workspaceId, {
      dateFrom: range.start ?? undefined,
      dateTo: range.end,
      limit: 2000,
    });
    csv = toCsv(tripRows(rows), TRIP_COLUMNS);
    fileSlug = "trips";
  } else {
    const rows = await listExpenses(ctx.workspaceId, {
      dateFrom: range.start ?? undefined,
      dateTo: range.end,
      limit: 2000,
    });
    csv = toCsv(expenseRows(rows), EXPENSE_COLUMNS);
    fileSlug = "expenses";
  }

  const today = new Date().toISOString().slice(0, 10);
  const filename = `drive-${fileSlug}-${today}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
