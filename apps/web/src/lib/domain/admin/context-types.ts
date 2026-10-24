import type { SessionUser } from "@/lib/domain/auth/session-types";
import type { AdminRole, AdminUser } from "@/lib/domain/admin/types";

export interface AdminContext {
  sessionUser: SessionUser;
  adminUser: AdminUser;
  roles: AdminRole[];
}
