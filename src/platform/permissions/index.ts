import type { WorkspaceRole } from "@/server/db/enums";

/**
 * Platform permission model (brief §11).
 *
 * Permissions are `verb:resource` strings. Verbs: view, create, update, delete,
 * manage, invite. Resources: workspace, billing, module, customer, invoice,
 * quote, books, drive, file, member, activity, audit.
 *
 * Implication rules (in `implies`):
 *   - `manage:R` implies every verb on resource R.
 *   - Any grant on R implies `view:R` (you can view what you can touch).
 *   - Non-manage verbs never imply each other (create doesn't grant delete).
 *
 * `delete:workspace` and `transfer:workspace` are owner-only because no role
 * below owner is granted them (and `update:workspace` does not imply them).
 *
 * NOTE: this module is pure data so it may be imported from client components
 * for UI gating (show/hide controls). That is a convenience only — every
 * mutation must re-check permissions server-side. Never trust client gating.
 */

export type Role = WorkspaceRole;

export type Resource =
  | "workspace"
  | "billing"
  | "module"
  | "customer"
  | "invoice"
  | "quote"
  | "books"
  | "drive"
  | "file"
  | "member"
  | "activity"
  | "audit";

export type Verb = "view" | "create" | "update" | "delete" | "manage" | "invite" | "transfer";

export type Permission = `${Verb}:${Resource}`;

export type PermissionCheckResult =
  { ok: true } | { ok: false; reason: "no_membership" | "insufficient_role" };

export const ROLES: readonly Role[] = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "employee",
  "readonly",
] as const;

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    "manage:billing",
    "manage:module",
    "manage:customer",
    "manage:invoice",
    "manage:quote",
    "manage:books",
    "manage:drive",
    "manage:file",
    "manage:member",
    "update:workspace",
    "delete:workspace",
    "transfer:workspace",
    "view:workspace",
    "view:activity",
    "view:audit",
  ],
  admin: [
    "manage:billing",
    "manage:module",
    "manage:customer",
    "manage:invoice",
    "manage:quote",
    "manage:books",
    "manage:drive",
    "manage:file",
    "manage:member",
    "update:workspace",
    "view:workspace",
    "view:activity",
    "view:audit",
  ],
  manager: [
    "manage:customer",
    "manage:invoice",
    "manage:quote",
    "manage:drive",
    "manage:file",
    "invite:member",
    "view:member",
    "view:books",
    "view:workspace",
    "view:billing",
    "view:activity",
  ],
  accountant: [
    "manage:customer",
    "manage:invoice",
    "manage:quote",
    "manage:books",
    "manage:file",
    "view:workspace",
    "view:billing",
    "view:activity",
    "view:audit",
  ],
  employee: [
    "manage:customer",
    "create:invoice",
    "create:quote",
    "manage:drive",
    "manage:file",
    "view:workspace",
    "view:activity",
  ],
  readonly: [
    "view:workspace",
    "view:billing",
    "view:customer",
    "view:invoice",
    "view:quote",
    "view:books",
    "view:drive",
    "view:file",
    "view:member",
    "view:activity",
  ],
};

function implies(grant: Permission, requested: Permission): boolean {
  if (grant === requested) return true;
  const [gVerb, gRes] = grant.split(":") as [Verb, Resource];
  const [rVerb, rRes] = requested.split(":") as [Verb, Resource];
  if (gRes !== rRes) return false;
  // manage implies every verb on the resource
  if (gVerb === "manage") return true;
  // any grant on a resource implies viewing it
  if (rVerb === "view") return true;
  return false;
}

/** Does `role` grant `permission`? Pure — safe to unit-test without a DB. */
export function can(role: Role, permission: Permission): boolean {
  const grants = ROLE_PERMISSIONS[role] ?? [];
  return grants.some((g) => implies(g, permission));
}

/**
 * Result of an authorization check that also accounts for membership existence.
 * Callers first resolve the member row, then call `authorize(role, permission)`.
 */
export function authorize(role: Role, permission: Permission): PermissionCheckResult {
  if (can(role, permission)) return { ok: true };
  return { ok: false, reason: "insufficient_role" };
}

/** Throw a 403-shaped error when the role lacks the permission. */
export function requirePermission(role: Role, permission: Permission): void {
  const result = authorize(role, permission);
  if (!result.ok) {
    throw new AuthorizationError(
      `Role "${role}" is not allowed to perform "${permission}".`,
      result.reason,
    );
  }
}

export class AuthorizationError extends Error {
  readonly reason: "insufficient_role" | "no_membership";
  constructor(message: string, reason: "insufficient_role" | "no_membership") {
    super(message);
    this.name = "AuthorizationError";
    this.reason = reason;
  }
}

export { ROLE_PERMISSIONS };
