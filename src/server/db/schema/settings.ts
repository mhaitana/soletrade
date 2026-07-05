import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";

/** One row per workspace. Extended in later phases (tax, notifications, etc.). */
export const workspaceSettings = pgTable("workspace_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .$type<WorkspaceId>()
    .references(() => workspaces.id)
    .unique(),
  defaultCurrency: text("default_currency").default("AUD").notNull(),
  timezone: text("timezone").default("Australia/Sydney").notNull(),
  invoicePrefix: text("invoice_prefix").default("INV-").notNull(),
  quotePrefix: text("quote_prefix").default("QUO-").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
