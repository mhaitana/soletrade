import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { DriveExpenseId, FileId, VehicleId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { vehicles } from "./vehicles";
import { vehicleExpenseTypeEnum } from "./enums";

/**
 * Driver vehicle expenses (Wave 2 — Drive). Fuel, maintenance, insurance,
 * registration and other vehicle running costs, workspace-scoped and optionally
 * linked to a `vehicles` row (cascade delete — a deleted vehicle takes its expense
 * history with it; this is intra-module, not cross-module, so a real FK is safe here).
 *
 * Money is integer cents (matches `book_transactions`). `receiptFileId` is a soft
 * link (no FK) mirroring `book_transactions.receiptFileId`. The
 * `VehicleExpenseLogged` event carries this row's id; the Books integration
 * subscriber writes an expense `book_transactions` row idempotent on `sourceExpenseId`.
 */
export const driverVehicleExpenses = pgTable(
  "driver_vehicle_expenses",
  {
    id: uuid("id").primaryKey().$type<DriveExpenseId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .$type<VehicleId>()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    type: vehicleExpenseTypeEnum("type").notNull(),
    /** Integer cents. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("AUD"),
    /** User-chosen expense date. */
    date: timestamp("date").notNull(),
    /** Optional odometer reading at the time of the expense (km, integer). */
    odometerKm: integer("odometer_km"),
    description: text("description").notNull(),
    notes: text("notes"),
    /** Soft link to a receipt file (no FK — mirrors `book_transactions.receiptFileId`). */
    receiptFileId: uuid("receipt_file_id").$type<FileId>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("driver_vehicle_expenses_workspace_date_idx").on(t.workspaceId, t.date),
    index("driver_vehicle_expenses_workspace_vehicle_idx").on(t.workspaceId, t.vehicleId),
  ],
);
