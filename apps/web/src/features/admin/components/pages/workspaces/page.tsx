import "server-only";
import * as React from "react";
import Link from "next/link";
import { Building2, ArrowUpRight } from "lucide-react";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { searchPlatformWorkspaces } from "@/server/application/admin/services/admin-workspaces";
import {
  AdminPageHeader,
  StatusBadge,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/features/admin/components/admin-ui";
import { AdminSearchForm } from "@/features/admin/components/admin-search-form";

export default async function AdminWorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  await requireAdminContext("view:workspaces");
  const { search } = await searchParams;
  const workspaces = await searchPlatformWorkspaces(search);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Building2}
        title="Workspace Management"
        subtitle="Tenant directory, subscriptions, ledger inspection, and customer-approved support access."
        action={<AdminSearchForm placeholder="Search by name…" />}
      />

      <AdminTable caption="Platform workspaces">
        <thead>
          <tr>
            <AdminTh>Workspace Name</AdminTh>
            <AdminTh>Slug</AdminTh>
            <AdminTh>Currency</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Created</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {workspaces.length === 0 ? (
            <EmptyRow colSpan={6}>
              {search ? `No workspaces match "${search}".` : "No registered workspaces found."}
            </EmptyRow>
          ) : (
            workspaces.map((ws) => (
              <AdminTr key={ws.id}>
                <AdminTd className="font-medium text-foreground">{ws.name}</AdminTd>
                <AdminTd>
                  <Mono className="text-[11px] text-muted-foreground">{ws.slug}</Mono>
                </AdminTd>
                <AdminTd>
                  <Mono className="text-muted-foreground">{ws.defaultCurrency}</Mono>
                </AdminTd>
                <AdminTd>
                  <StatusBadge status={ws.isSuspended ? "suspended" : "active"} />
                </AdminTd>
                <AdminTd className="text-muted-foreground">
                  {ws.createdAt.toLocaleDateString()}
                </AdminTd>
                <AdminTd className="text-right">
                  <Link
                    href={`/admin/workspaces/${ws.id}`}
                    className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline"
                    aria-label={`Inspect workspace ${ws.name}`}
                  >
                    Inspect <ArrowUpRight className="size-3.5" />
                  </Link>
                </AdminTd>
              </AdminTr>
            ))
          )}
        </tbody>
      </AdminTable>
    </div>
  );
}
