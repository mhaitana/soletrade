import "server-only";
import * as React from "react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { AdminShell } from "@/platform/admin/components/admin-shell";

export const metadata = {
  title: "Soletrade Operations | Internal Admin Area",
  description: "Secure internal operations area for Soletrade Workspace platform administration.",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await requireAdminContext();

  return (
    <AdminShell
      adminName={ctx.adminUser.fullName}
      adminEmail={ctx.adminUser.email}
      roles={ctx.roles}
    >
      {children}
    </AdminShell>
  );
}
