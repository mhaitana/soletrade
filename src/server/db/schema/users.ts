import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { UserId } from "@/shared/types/ids";

/**
 * Public profile mirror of the Supabase Auth user (auth.users). The Supabase
 * user id is the primary key here too, so joins on user identity stay simple.
 * A trigger (or the signup flow) inserts a row here when a user signs up.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().$type<UserId>(),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
