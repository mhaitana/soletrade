import type { AdminContext } from "@/lib/domain/admin/context-types";
export type { AdminContext } from "@/lib/domain/admin/context-types";
import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/server/application/auth/session";

import { getActiveAdminUserByEmail } from "@/server/foundation/identity/admin";

import {
  requireAdminPermission,
  type AdminPermission,
  AdminAuthorizationError,
} from "@/lib/domain/admin/permissions";

/**
 * Resolve the internal admin user and roles for the current request session.
 * Returns null if the signed-in user is not an active staff member.
 */
async function resolveAdminContext(): Promise<AdminContext | null> {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return null;

  const adminUser = await getActiveAdminUserByEmail(sessionUser.email);
  if (!adminUser) return null;
  const roles = adminUser.roles;

  return { sessionUser, adminUser, roles };
}

export const tryAdminContext = cache(resolveAdminContext);

/**
 * Require a valid active internal staff account and optionally a specific permission.
 * Redirects unauthenticated requests to `/login`.
 */
export async function requireAdminContext(
  requiredPermission?: AdminPermission,
): Promise<AdminContext> {
  const ctx = await tryAdminContext();
  if (!ctx) {
    throw new AdminAuthorizationError(
      "Access denied: Internal staff privileges required.",
      "unauthorized_admin",
    );
  }

  if (requiredPermission) {
    requireAdminPermission(ctx.roles, requiredPermission);
  }

  return ctx;
}

/**
 * List active internal staff for assignment pickers (e.g. support ticket assignment).
 * Returns operational metadata only (id + name + email). Requires the caller to
 * already hold an admin context (view:support_tickets).
 */
export {
  listAssignableAdminStaff,
  logAdminSecurityEvent,
} from "@/server/foundation/identity/admin";
