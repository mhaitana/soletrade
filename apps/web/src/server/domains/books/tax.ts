import type { TaxPeriodRow } from "@/lib/domain/books/tax-types";
export type { TaxPeriodRow } from "@/lib/domain/books/tax-types";
import "server-only";
import { getDataClient } from "@/server/infrastructure/db/client";
import {
  parsePgTimestamp,
  unwrap,
  unwrapMaybe,
  unwrapVoid,
} from "@/server/infrastructure/db/helpers";
import { writeAudit } from "@/server/foundation/audit";
import { getBookSummary } from "@/server/domains/books/index";
import { fiscalQuarter } from "@/lib/domain/books/calc";
import { branded, type UserId, type WorkspaceId } from "@/types/ids";

/**
 * Tax-period / BAS lodgement service (Wave 2). `tax_periods` rows are written ONLY when a
 * workspace lodges a quarter - a locked snapshot of the GST position at lodgement time.
 * Un-lodged quarters are computed on the fly from `book_transactions.gstCents` (the source
 * of truth) via `summarizeGst` in `calc.ts`. This service handles the lodgement write +
 * the list/get reads for the `/books/tax` page.
 */

/**
 * Date range (UTC) for a financial-year quarter. `fyStartMonth` is 1–12 (default `7` = 1 July,
 * Australian); the quarter starts on day 1 of `fyStartMonth + (quarter-1)*3` (mod 12).
 * `end` is the inclusive last ms of the quarter (first ms of the next quarter − 1).
 */
export function quarterRange(
  fiscalYear: number,
  quarter: number,
  fyStartMonth: number = 7,
): { start: Date; end: Date } {
  const startMonthIdx = fyStartMonth - 1; // 0–11
  // Absolute month index from a fixed epoch: fiscalYear's FY-start month + (quarter-1)*3.
  // Q1/Q2 fall in `fiscalYear` (the FY-start calendar year); Q3/Q4 fall in `fiscalYear + 1`.
  const absStartMonth = startMonthIdx + (quarter - 1) * 3; // months since Jan of fiscalYear
  const year = fiscalYear + Math.floor(absStartMonth / 12);
  const month = absStartMonth % 12;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 3, 1) - 1); // inclusive last ms of the quarter
  return { start, end };
}

const TAX_PERIOD_COLUMNS =
  "id, workspace_id, fiscal_year, quarter, period_label, gst_collected_cents, gst_paid_cents, net_gst_cents, lodged_at, created_at, updated_at";

/** Maps a snake_case PostgREST tax_periods row to the camelCase `TaxPeriodRow`. */
function toTaxPeriodRow(r: {
  id: string;
  workspace_id: string;
  fiscal_year: number;
  quarter: number;
  period_label: string;
  gst_collected_cents: number;
  gst_paid_cents: number;
  net_gst_cents: number;
  lodged_at: string | null;
  created_at: string;
  updated_at: string;
}): TaxPeriodRow {
  return {
    id: branded<"TaxPeriodId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    fiscalYear: r.fiscal_year,
    quarter: r.quarter,
    periodLabel: r.period_label,
    gstCollectedCents: r.gst_collected_cents,
    gstPaidCents: r.gst_paid_cents,
    netGstCents: r.net_gst_cents,
    lodgedAt: r.lodged_at ? parsePgTimestamp(r.lodged_at) : null,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/**
 * Lodge a quarter: compute the GST snapshot from `book_transactions` for the quarter,
 * upsert a `tax_periods` row with `lodgedAt` + `lodgedByUserId`. Idempotent on
 * (workspaceId, periodLabel) - lodging an already-lodged quarter re-snapshots (updates the
 * amounts + re-stamps `lodgedAt`) so corrections after a re-open flow are captured. The
 * unique index guards against duplicate concurrent lodgements.
 */
export async function lodgeTaxPeriod(
  workspaceId: WorkspaceId,
  fiscalYear: number,
  quarter: number,
  actorId: UserId,
  fyStartMonth: number = 7,
): Promise<TaxPeriodRow> {
  if (quarter < 1 || quarter > 4) throw new Error("Quarter must be 1–4.");
  const label = `${fiscalYear}-Q${quarter}`;
  const { start, end } = quarterRange(fiscalYear, quarter, fyStartMonth);

  const supabase = getDataClient();
  // GST collected (income) and paid (expense) for the quarter, summed in Postgres by the
  // same function the Books summary uses. Summing fetched rows here would silently stop at
  // the data API's 1,000-row cap and lodge a wrong figure for a busy quarter.
  const { gstCollectedCents, gstPaidCents } = await getBookSummary(workspaceId, {
    dateFrom: start,
    dateTo: end,
  });
  const netGstCents = gstCollectedCents - gstPaidCents;
  const lodgedAt = new Date();
  const lodgedAtIso = lodgedAt.toISOString();

  // Upsert: if the quarter is already lodged, re-snapshot (update amounts + re-stamp).
  const existing = await unwrapMaybe(
    supabase
      .from("tax_periods")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("period_label", label)
      .limit(1)
      .maybeSingle(),
  );
  if (existing) {
    const existingId = branded<"TaxPeriodId">(existing.id);
    await unwrapVoid(
      supabase
        .from("tax_periods")
        .update({
          gst_collected_cents: gstCollectedCents,
          gst_paid_cents: gstPaidCents,
          net_gst_cents: netGstCents,
          lodged_at: lodgedAtIso,
          lodged_by_user_id: actorId,
          updated_at: lodgedAtIso,
        })
        .eq("id", existingId),
    );
    await writeAudit({
      workspaceId,
      actorUserId: actorId,
      action: "books.tax.lodge",
      targetType: "tax_period",
      targetId: existingId,
      metadata: { periodLabel: label, gstCollectedCents, gstPaidCents, netGstCents, reLodge: true },
    });
  } else {
    // onConflictDoNothing → upsert with ignoreDuplicates so a concurrent duplicate lodge
    // for the same (workspace_id, period_label) is skipped rather than erroring.
    const inserted = await unwrap(
      supabase
        .from("tax_periods")
        .upsert(
          {
            workspace_id: workspaceId,
            fiscal_year: fiscalYear,
            quarter,
            period_label: label,
            gst_collected_cents: gstCollectedCents,
            gst_paid_cents: gstPaidCents,
            net_gst_cents: netGstCents,
            lodged_at: lodgedAtIso,
            lodged_by_user_id: actorId,
          },
          { onConflict: "workspace_id,period_label", ignoreDuplicates: true },
        )
        .select("id"),
    );
    const id = inserted[0]?.id;
    if (id) {
      await writeAudit({
        workspaceId,
        actorUserId: actorId,
        action: "books.tax.lodge",
        targetType: "tax_period",
        targetId: branded<"TaxPeriodId">(id),
        metadata: { periodLabel: label, gstCollectedCents, gstPaidCents, netGstCents },
      });
    }
  }

  const row = await unwrapMaybe(
    supabase
      .from("tax_periods")
      .select(TAX_PERIOD_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("period_label", label)
      .limit(1)
      .maybeSingle(),
  );
  if (!row) throw new Error("Failed to lodge tax period.");
  return toTaxPeriodRow(row);
}

/** List all lodged tax periods for a workspace, oldest first. */
export async function listTaxPeriods(workspaceId: WorkspaceId): Promise<TaxPeriodRow[]> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("tax_periods")
      .select(TAX_PERIOD_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("fiscal_year", { ascending: true })
      .order("quarter", { ascending: true }),
  );
  return rows.map(toTaxPeriodRow);
}

/** The current financial-year quarter containing `now`, per the workspace's `fyStartMonth`
 *  (1–12, default `7` = 1 July). */
export function currentQuarter(
  now: Date,
  fyStartMonth: number = 7,
): { fiscalYear: number; quarter: number; label: string } {
  return fiscalQuarter(now, fyStartMonth);
}
