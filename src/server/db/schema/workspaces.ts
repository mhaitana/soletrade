import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
