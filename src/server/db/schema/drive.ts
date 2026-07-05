import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { DriveEarningId, DriveTripId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";

/**
 * Drive module schema (Phase 7) — gig earnings + mileage tracking for
 * rideshare/delivery drivers. Two independent flat tables, both workspace-scoped:
 *
 * - `driveEarnings` — a dated money entry (what the driver earned on a platform).
 * - `driveTrips`    — a dated distance entry (how far the driver drove on a platform).
 *
 * There is **no FK between the two** — a trip and an earning are correlated by date +
 * platform in the UI, not enforced at the DB level (linking is deferred; not requested this
 * phase). Both mirror the Books table conventions: branded UUID PK, `workspaceId` FK, text
 * `platform` slug, user-chosen `date`, `createdAt`/`updatedAt`. No cascade on workspace —
 * historical rows are preserved when a workspace is soft-deleted (mirrors `bookTransactions`).
 *
 * Money is integer cents (matches `book_transactions`). Distance is integer **meters** (the
 * smallest unit, mirroring the cents pattern) so fractional km never enters the DB as a float;
 * the UI converts to km for display via the pure `formatKm` helper in `@/modules/drive/calc`.
 *
 * `platform` is a slug from the pure `src/shared/constants/drive-platforms` catalog, validated
 * at the action boundary + in the service. Stored as `text` (not an enum) so the seed list can
 * grow without a DB migration (mirrors `book_transactions.category`).
 *
 * The cross-module integration (DriveEarningsLogged → Books income) goes via the event bus —
 * Books adds a `sourceEarningId` link column to `book_transactions` (no FK, indexed for the
 * idempotency check), mirroring the InvoicePaid integration. This file stays decoupled from
 * Books at the DB level.
 */
export const driveEarnings = pgTable(
  "drive_earnings",
  {
    id: uuid("id").primaryKey().$type<DriveEarningId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Slug from `src/shared/constants/drive-platforms`, validated in the service. */
    platform: text("platform").notNull(),
    /** Integer cents — the amount earned on this platform for this date. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("AUD"),
    /** User-chosen earning date (when the gig income was earned). */
    date: timestamp("date").notNull(),
    description: text("description").notNull(),
    /** Private workspace note (never exposed publicly). */
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // Primary list view is "newest earning date first"; secondary order keeps ties
    // deterministic.
    index("drive_earnings_workspace_date_idx").on(t.workspaceId, t.date),
    index("drive_earnings_workspace_platform_idx").on(t.workspaceId, t.platform),
  ],
);

export const driveTrips = pgTable(
  "drive_trips",
  {
    id: uuid("id").primaryKey().$type<DriveTripId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Slug from `src/shared/constants/drive-platforms`, validated in the service. */
    platform: text("platform").notNull(),
    /** Integer meters — the distance driven (smallest unit; UI displays km via `formatKm`). */
    distanceMeters: integer("distance_meters").notNull(),
    /** User-chosen trip date (when the driving occurred). */
    date: timestamp("date").notNull(),
    /** Short reason for the trip (e.g. "Airport run"). */
    purpose: text("purpose"),
    /** Private workspace note (never exposed publicly). */
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("drive_trips_workspace_date_idx").on(t.workspaceId, t.date),
    index("drive_trips_workspace_platform_idx").on(t.workspaceId, t.platform),
  ],
);
