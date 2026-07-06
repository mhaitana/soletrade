import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { VehicleId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";

/**
 * Vehicles (Wave 2 — Drive). A workspace can register the vehicles it uses for gig
 * work so fuel/maintenance/insurance expenses can be logged against them and the
 * cents-per-km deduction can be applied per vehicle. No cascade on workspace —
 * historical rows preserved on soft-delete (mirrors `bookTransactions`).
 */
export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().$type<VehicleId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** Friendly label e.g. "Prius", "Courier van". */
    name: text("name").notNull(),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    /** Last known odometer in km (integer; updated as expenses/trips are logged). */
    odometerKm: integer("odometer_km"),
    /** Soft-delete flag — inactive vehicles are hidden from selectors but kept for history. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("vehicles_workspace_active_idx").on(t.workspaceId, t.active)],
);
