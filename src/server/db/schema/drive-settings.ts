import { integer, pgTable, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import type { DriverProfileId, VehicleId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { vehicles } from "./vehicles";

/**
 * Driver profile / Drive settings (Wave 2). One row per workspace (unique on
 * `workspaceId`) carrying the cents-per-km mileage-deduction rate and the default
 * vehicle for quick-logging. Created lazily (upsert on first settings save). The ATO
 * cents-per-km method is an integer cents/km rate (e.g. 85 for 2024–25), so the
 * deduction is `round(distanceKm * mileageRateCentsPerKm)` — no fractional currency
 * enters the DB.
 */
export const driverProfiles = pgTable(
  "driver_profiles",
  {
    id: uuid("id").primaryKey().$type<DriverProfileId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    /** ATO cents-per-km deduction rate (integer cents per kilometre). */
    mileageRateCentsPerKm: integer("mileage_rate_cents_per_km").notNull().default(85),
    /** Optional default vehicle for quick-logging (set null if the vehicle is deleted). */
    defaultVehicleId: uuid("default_vehicle_id")
      .$type<VehicleId>()
      .references(() => vehicles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("driver_profiles_workspace_unique").on(t.workspaceId)],
);
