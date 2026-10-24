import { signOutAction } from "@/features/auth/api/auth";
import "server-only";
import * as React from "react";
import { brand } from "@/config/brand";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { getActiveSupportAccessSession } from "@/server/application/admin/services/admin-support-access";
import { AdminShell } from "@/features/admin/components/admin-shell";

// All admin routes are authenticated and read request-scoped session/database data.
// Never prerender this tree at build time or cache one admin's context for another.

export const metadata = {
  title: "Soletrade Operations | Internal Admin Area",
  description: `Secure internal operations area for ${brand.productName} platform administration.`,
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAdminContext();
  // Resolve the admin's active customer-approved support session (Principle #15)
  // so the persistent banner renders across every admin page.
  const activeSupportSession = await getActiveSupportAccessSession(ctx.adminUser.id);

  return (
    <AdminShell
      signOutAction={signOutAction}
      adminName={ctx.adminUser.fullName}
      adminEmail={ctx.adminUser.email}
      roles={ctx.roles}
      activeSupportSession={activeSupportSession}
    >
      {children}
    </AdminShell>
  );
}
