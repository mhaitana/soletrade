import { pgEnum } from "drizzle-orm/pg-core";
import { MODULE_KEYS } from "@/shared/constants/modules";

/** Workspace roles (brief §11). Ordered loosely by privilege — do not rely on order for authz. */
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "manager",
  "accountant",
  "employee",
  "readonly",
]);
export type WorkspaceRole = (typeof workspaceRoleEnum.enumValues)[number];

/** Product modules — mirrors shared/constants/modules MODULE_KEYS. */
export const moduleKeyEnum = pgEnum("module_key", [...MODULE_KEYS]);
export type ModuleKey = (typeof moduleKeyEnum.enumValues)[number];

export const moduleInstallationStatusEnum = pgEnum("module_installation_status", [
  "active",
  "cancelled",
]);
export type ModuleInstallationStatus = (typeof moduleInstallationStatusEnum.enumValues)[number];

export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);
export type InvitationStatus = (typeof invitationStatusEnum.enumValues)[number];
