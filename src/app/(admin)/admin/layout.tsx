import "server-only";
import * as React from "react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { getActiveSupportAccessSession } from "@/platform/admin/services/admin-support-access";
import { AdminShell } from "@/platform/admin/components/admin-shell";

// All admin routes are authenticated and read request-scoped session/database data.
// Never prerender this tree at build time or cache one admin's context for another.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Soletrade Operations | Internal Admin Area",
  description: "Secure internal operations area for Soletrade Workspace platform administration.",
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdminContext();
  // Resolve the admin's active customer-approved support session (Principle #15)
  // so the persistent banner renders across every admin page.
  const activeSupportSession = await getActiveSupportAccessSession(ctx.adminUser.id);

  return (
    <AdminShell
      adminName={ctx.adminUser.fullName}
      adminEmail={ctx.adminUser.email}
      roles={ctx.roles}
      activeSupportSession={activeSupportSession}
    >
      {children}
    </AdminShell>
  );
}
