import "server-only";
import { cache } from "react";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { getAdminDb } from "./db";
import type { AdminRole, AdminUser } from "@/platform/admin/types";
import {
  requireAdminPermission,
  type AdminPermission,
  AdminAuthorizationError,
} from "@/platform/admin/permissions";

export interface AdminContext {
  sessionUser: SessionUser;
  adminUser: AdminUser;
  roles: AdminRole[];
}

/**
 * Resolve the internal admin user and roles for the current request session.
 * Returns null if the signed-in user is not an active staff member.
 */
async function resolveAdminContext(): Promise<AdminContext | null> {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return null;

  const db = getAdminDb();
  const { data: adminRow, error } = await db
    .from("admin_users")
    .select("id, email, full_name, is_active, mfa_enabled, created_at, updated_at")
    .eq("email", sessionUser.email)
    .single();

  if (error || !adminRow || !(adminRow as { is_active?: boolean }).is_active) {
    return null;
  }

  const typedAdminRow = adminRow as {
    id: string;
    email: string;
    full_name: string;
    is_active: boolean;
    mfa_enabled: boolean;
    created_at: string;
    updated_at: string;
  };

  const { data: roleRows } = await db
    .from("admin_role_assignments")
    .select("role")
    .eq("admin_user_id", typedAdminRow.id);

  const roles: AdminRole[] =
    (roleRows as Array<{ role: AdminRole }> | null)?.map((r) => r.role) ?? [];

  const adminUser: AdminUser = {
    id: typedAdminRow.id,
    email: typedAdminRow.email,
    fullName: typedAdminRow.full_name,
    isActive: typedAdminRow.is_active,
    mfaEnabled: typedAdminRow.mfa_enabled,
    roles,
    createdAt: new Date(typedAdminRow.created_at),
    updatedAt: new Date(typedAdminRow.updated_at),
  };

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
export async function listAssignableAdminStaff(): Promise<
  Array<{ id: string; fullName: string; email: string }>
> {
  // No permission gate here — the caller (page) already checked its own permission;
  // this is a read of staff metadata to populate a select.
  const db = getAdminDb();
  const { data: rows } = await db
    .from("admin_users")
    .select("id, full_name, email")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (!rows) return [];
  return (rows as Array<{ id: string; full_name: string; email: string }>).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
  }));
}

/**
 * Log a security event related to admin access or authentication.
 */
export async function logAdminSecurityEvent(params: {
  adminUserId?: string;
  eventType: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getAdminDb();
  await db.from("admin_security_events").insert({
    admin_user_id: params.adminUserId ?? null,
    event_type: params.eventType,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
    metadata: params.metadata ?? null,
  });
}
