import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
import { users } from "./users";

/** A workspace is the billing + isolation boundary. One Stripe customer per workspace. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().$type<WorkspaceId>().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: uuid("owner_user_id")
    .notNull()
    .$type<UserId>()
    .references(() => users.id),
  defaultCurrency: text("default_currency").default("AUD").notNull(),
  /** IANA timezone for display, e.g. "Australia/Sydney". Stored dates stay UTC. */
  timezone: text("timezone").default("Australia/Sydney").notNull(),
  /** Prefix for new invoice numbers, e.g. "INV-" → "INV-2026-0001". Changing it resets the yearly sequence. */
  invoicePrefix: text("invoice_prefix").default("INV-").notNull(),
  /** Prefix for new quote numbers, e.g. "QUO-" → "QUO-2026-0001". */
  quotePrefix: text("quote_prefix").default("QUO-").notNull(),
  /** Financial-year start month, 1–12 (1 = January = calendar year). Default 7 = 1 July (AU). Drives GST/BAS quarter labels + the "year"/"quarter" period-selector windows. */
  fyStartMonth: integer("fy_start_month").default(7).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
