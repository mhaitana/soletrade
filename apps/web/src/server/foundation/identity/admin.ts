import "server-only";
import { getAdminDb } from "./db";
import type { AdminRole, AdminUser } from "@/lib/domain/admin/types";

/** Resolve active staff identity without depending on request or session state. */
export async function getActiveAdminUserByEmail(email: string): Promise<AdminUser | null> {
  const db = getAdminDb();
  const { data: adminRow, error } = await db
    .from("admin_users")
    .select("id, email, full_name, is_active, mfa_enabled, created_at, updated_at")
    .eq("email", email)
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

  return adminUser;
}

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
