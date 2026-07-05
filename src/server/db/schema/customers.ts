import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CustomerId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";

/**
 * Shared, workspace-scoped customer record (brief §7.3). Customers are not
 * duplicated per module — Invoices, Quotes, Books, and Drive all reference this
 * one table. Soft-deleted via `deletedAt`; the partial unique index on email
 * excludes soft-deleted rows so an address can be reused after a customer is
 * removed, and allows multiple walk-in customers with no email (NULLs are
 * distinct in Postgres unique indexes).
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().$type<CustomerId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    company: text("company"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    uniqueIndex("customers_workspace_email_unique")
      .on(t.workspaceId, t.email)
      .where(sql`${t.email} is not null and ${t.deletedAt} is null`),
    index("customers_workspace_idx").on(t.workspaceId),
  ],
);
