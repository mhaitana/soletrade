import { integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import type { TaxPeriodId, UserId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * Tax periods (Wave 2 — GST/BAS lodgement snapshots). A row is written ONLY when a
 * workspace lodges a quarter's BAS — it is a locked snapshot of the GST position at
 * lodgement time, not a row per quarter. Un-lodged quarters are computed on the fly
 * from `book_transactions.gstCents` (the source of truth).
 *
 * Australian GST quarters are calendar-based by default (Q1 = Jul–Sep, Q2 = Oct–Dec,
 * Q3 = Jan–Mar, Q4 = Apr–Jun, aligned to the financial year starting 1 July). The
 * `periodLabel` is the canonical key (e.g. `"2026-Q1"` where 2026 is the financial-year
 * start). `(workspaceId, periodLabel)` is unique so a quarter can't be lodged twice.
 */
export const taxPeriods = pgTable(
  "tax_periods",
  {
    id: uuid("id").primaryKey().$type<TaxPeriodId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Financial-year start (e.g. 2026 for FY2026–27). */
    fiscalYear: integer("fiscal_year").notNull(),
    /** Quarter within the fiscal year, 1–4. */
    quarter: integer("quarter").notNull(),
    /** Canonical label e.g. "2026-Q1" — the unique human key. */
    periodLabel: text("period_label").notNull(),
    /** GST collected (sum of income `gstCents`) at lodgement time. */
    gstCollectedCents: integer("gst_collected_cents").notNull().default(0),
    /** GST paid / claimable (sum of expense `gstCents`) at lodgement time. */
    gstPaidCents: integer("gst_paid_cents").notNull().default(0),
    /** Net GST remittable (collected − paid). Can be negative (refund). */
    netGstCents: integer("net_gst_cents").notNull().default(0),
    /** When the quarter was lodged (null until lodged). */
    lodgedAt: timestamp("lodged_at"),
    /** Who lodged it. */
    lodgedByUserId: uuid("lodged_by_user_id")
      .$type<UserId>()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // A quarter can be lodged at most once per workspace.
    uniqueIndex("tax_periods_workspace_period_unique").on(t.workspaceId, t.periodLabel),
  ],
);
