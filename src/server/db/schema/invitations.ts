import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { UserId, WorkspaceId, WorkspaceInvitationId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";
import { invitationStatusEnum, workspaceRoleEnum } from "./enums";

export const workspaceInvitations = pgTable("workspace_invitations", {
  id: uuid("id").primaryKey().$type<WorkspaceInvitationId>().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .$type<WorkspaceId>()
    .references(() => workspaces.id),
  email: text("email").notNull(),
  role: workspaceRoleEnum("role").notNull().default("employee"),
  invitedByUserId: uuid("invited_by_user_id")
    .$type<UserId>()
    .references(() => users.id),
  /** Unguessable single-use token; the public accept link is `/invite?token=...`. */
  token: text("token").notNull().unique(),
  status: invitationStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
