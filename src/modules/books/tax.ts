import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/server/db";
import { bookTransactions, taxPeriods } from "@/server/db/schema";
import { writeAudit } from "@/platform/audit";
import { fiscalQuarter } from "./calc";
import type { TaxPeriodId, UserId, WorkspaceId } from "@/shared/types/ids";

/**
 * Tax-period / BAS lodgement service (Wave 2). `tax_periods` rows are written ONLY when a
 * workspace lodges a quarter — a locked snapshot of the GST position at lodgement time.
 * Un-lodged quarters are computed on the fly from `book_transactions.gstCents` (the source
 * of truth) via `summarizeGst` in `calc.ts`. This service handles the lodgement write +
 * the list/get reads for the `/books/tax` page.
 */

/**
 * Date range (UTC) for a financial-year quarter. `fyStartMonth` is 1–12 (default `7` = 1 July,
 * Australian); the quarter starts on day 1 of `fyStartMonth + (quarter-1)*3` (mod 12).
 * `end` is the inclusive last ms of the quarter (first ms of the next quarter − 1).
 */
function quarterRange(
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

export interface TaxPeriodRow {
  id: TaxPeriodId;
  workspaceId: WorkspaceId;
  fiscalYear: number;
  quarter: number;
  periodLabel: string;
  gstCollectedCents: number;
  gstPaidCents: number;
  netGstCents: number;
  lodgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lodge a quarter: compute the GST snapshot from `book_transactions` for the quarter,
 * upsert a `tax_periods` row with `lodgedAt` + `lodgedByUserId`. Idempotent on
 * (workspaceId, periodLabel) — lodging an already-lodged quarter re-snapshots (updates the
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

  const db = getDb();
  // Sum GST collected (income) and paid (expense) for the quarter from transactions.
  const txRows = await db
    .select({ type: bookTransactions.type, gstCents: bookTransactions.gstCents })
    .from(bookTransactions)
    .where(
      and(
        eq(bookTransactions.workspaceId, workspaceId),
        gte(bookTransactions.date, start),
        lte(bookTransactions.date, end),
      ),
    );
  let gstCollectedCents = 0;
  let gstPaidCents = 0;
  for (const r of txRows) {
    const gst = Math.abs(r.gstCents ?? 0);
    if (r.type === "income") gstCollectedCents += gst;
    else gstPaidCents += gst;
  }
  const netGstCents = gstCollectedCents - gstPaidCents;
  const lodgedAt = new Date();

  // Upsert: if the quarter is already lodged, re-snapshot (update amounts + re-stamp).
  const existing = await db
    .select({ id: taxPeriods.id })
    .from(taxPeriods)
    .where(and(eq(taxPeriods.workspaceId, workspaceId), eq(taxPeriods.periodLabel, label)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(taxPeriods)
      .set({
        gstCollectedCents,
        gstPaidCents,
        netGstCents,
        lodgedAt,
        lodgedByUserId: actorId,
        updatedAt: lodgedAt,
      })
      .where(eq(taxPeriods.id, existing[0].id));
    await writeAudit({
      workspaceId,
      actorUserId: actorId,
      action: "books.tax.lodge",
      targetType: "tax_period",
      targetId: existing[0].id,
      metadata: { periodLabel: label, gstCollectedCents, gstPaidCents, netGstCents, reLodge: true },
    });
  } else {
    const inserted = await db
      .insert(taxPeriods)
      .values({
        workspaceId,
        fiscalYear,
        quarter,
        periodLabel: label,
        gstCollectedCents,
        gstPaidCents,
        netGstCents,
        lodgedAt,
        lodgedByUserId: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: taxPeriods.id });
    const id = inserted[0]?.id;
    if (id) {
      await writeAudit({
        workspaceId,
        actorUserId: actorId,
        action: "books.tax.lodge",
        targetType: "tax_period",
        targetId: id,
        metadata: { periodLabel: label, gstCollectedCents, gstPaidCents, netGstCents },
      });
    }
  }

  const rows = await db
    .select()
    .from(taxPeriods)
    .where(and(eq(taxPeriods.workspaceId, workspaceId), eq(taxPeriods.periodLabel, label)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Failed to lodge tax period.");
  return row as TaxPeriodRow;
}

/** List all lodged tax periods for a workspace, oldest first. */
export async function listTaxPeriods(workspaceId: WorkspaceId): Promise<TaxPeriodRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(taxPeriods)
    .where(eq(taxPeriods.workspaceId, workspaceId))
    .orderBy(asc(taxPeriods.fiscalYear), asc(taxPeriods.quarter));
  return rows as TaxPeriodRow[];
}

/** The current financial-year quarter containing `now`, per the workspace's `fyStartMonth`
 *  (1–12, default `7` = 1 July). */
export function currentQuarter(
  now: Date,
  fyStartMonth: number = 7,
): { fiscalYear: number; quarter: number; label: string } {
  return fiscalQuarter(now, fyStartMonth);
}
