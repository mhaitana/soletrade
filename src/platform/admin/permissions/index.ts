import type { AdminRole, SupportAccessScope, SupportAccessSession } from "@/platform/admin/types";

export type AdminResource =
  | "staff"
  | "users"
  | "workspaces"
  | "subscriptions"
  | "promotions"
  | "credits"
  | "support_tickets"
  | "support_access"
  | "audit_logs"
  | "operations"
  | "feature_flags"
  | "system_health";

export type AdminVerb = "view" | "create" | "update" | "delete" | "manage" | "approve";

export type AdminPermission = `${AdminVerb}:${AdminResource}`;

export const ADMIN_ROLES: readonly AdminRole[] = [
  "super_admin",
  "operations_admin",
  "billing_admin",
  "support_manager",
  "support_agent",
  "security_auditor",
  "read_only_admin",
] as const;

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  super_admin: [
    "manage:staff",
    "manage:users",
    "manage:workspaces",
    "manage:subscriptions",
    "manage:promotions",
    "manage:credits",
    "manage:support_tickets",
    "manage:support_access",
    "manage:audit_logs",
    "manage:operations",
    "manage:feature_flags",
    "manage:system_health",
  ],
  operations_admin: [
    "manage:users",
    "manage:workspaces",
    "view:subscriptions",
    "view:credits",
    "manage:operations",
    "view:audit_logs",
    "view:system_health",
  ],
  billing_admin: [
    "view:users",
    "view:workspaces",
    "manage:subscriptions",
    "manage:promotions",
    "manage:credits",
    "view:audit_logs",
  ],
  support_manager: [
    "view:users",
    "view:workspaces",
    "manage:support_tickets",
    "manage:support_access",
    "view:subscriptions",
    "view:credits",
    "view:audit_logs",
  ],
  support_agent: [
    "view:users",
    "view:workspaces",
    "update:support_tickets",
    "create:support_access",
    "view:subscriptions",
    "create:credits",
  ],
  security_auditor: [
    "view:users",
    "view:workspaces",
    "view:subscriptions",
    "view:support_tickets",
    "view:support_access",
    "view:audit_logs",
    "view:operations",
    "view:feature_flags",
    "view:system_health",
  ],
  read_only_admin: [
    "view:users",
    "view:workspaces",
    "view:subscriptions",
    "view:support_tickets",
    "view:operations",
    "view:system_health",
  ],
};

function impliesPermission(grant: AdminPermission, requested: AdminPermission): boolean {
  if (grant === requested) return true;
  const [gVerb, gRes] = grant.split(":") as [AdminVerb, AdminResource];
  const [rVerb, rRes] = requested.split(":") as [AdminVerb, AdminResource];
  if (gRes !== rRes) return false;
  if (gVerb === "manage") return true;
  if (rVerb === "view") return true;
  return false;
}

/**
 * Checks whether any of the supplied admin roles grant the requested permission.
 */
export function canAdmin(roles: AdminRole[], permission: AdminPermission): boolean {
  for (const role of roles) {
    const grants = ADMIN_ROLE_PERMISSIONS[role] ?? [];
    if (grants.some((g) => impliesPermission(g, permission))) {
      return true;
    }
  }
  return false;
}

/**
 * Throws a clean AuthorizationError when the admin lacks the permission.
 */
export function requireAdminPermission(roles: AdminRole[], permission: AdminPermission): void {
  if (!canAdmin(roles, permission)) {
    throw new AdminAuthorizationError(
      `Admin roles [${roles.join(", ")}] are not allowed to perform "${permission}".`,
      "insufficient_permission",
    );
  }
}

/**
 * Checks if the internal admin can access customer business content.
 * Principle #3 & #4: Admins must NEVER automatically access customer content without an active,
 * unexpired SupportAccessSession approved by the customer that covers the requested scope.
 */
export function canAdminAccessCustomerContent(
  activeSession: SupportAccessSession | null | undefined,
  requestedScope: SupportAccessScope,
): boolean {
  if (!activeSession) return false;
  if (activeSession.status !== "active") return false;

  const now = new Date();
  if (new Date(activeSession.expiresAt) <= now) return false;
  if (activeSession.revokedAt) return false;

  return activeSession.scopes.includes(requestedScope);
}

export class AdminAuthorizationError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "AdminAuthorizationError";
    this.reason = reason;
  }
}
