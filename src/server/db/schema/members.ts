import { pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { UserId, WorkspaceId, WorkspaceMemberId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";
import { workspaceRoleEnum } from "./enums";

/** Membership links a user to a workspace with a role. Unique per (workspace, user). */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().$type<WorkspaceMemberId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    userId: uuid("user_id")
      .notNull()
      .$type<UserId>()
      .references(() => users.id),
    role: workspaceRoleEnum("role").notNull().default("employee"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [uniqueIndex("workspace_members_workspace_user_unique").on(t.workspaceId, t.userId)],
);
