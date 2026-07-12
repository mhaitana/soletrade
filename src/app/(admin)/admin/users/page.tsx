import "server-only";
import * as React from "react";
import Link from "next/link";
import { Users, ArrowUpRight } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { searchPlatformUsers } from "@/platform/admin/services/admin-users";
import {
  AdminPageHeader,
  StatusBadge,
  AdminTable,
  AdminTh,
  AdminTd,
  AdminTr,
  EmptyRow,
  Mono,
} from "@/platform/admin/components/admin-ui";
import { AdminSearchForm } from "@/platform/admin/components/admin-search-form";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  await requireAdminContext("view:users");
  const { search } = await searchParams;
  const users = await searchPlatformUsers(search);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Users}
        title="User Management"
        subtitle="Search and inspect platform accounts (operational metadata only; Principle #3)."
        action={<AdminSearchForm placeholder="Search by email…" />}
      />

      <AdminTable caption="Platform users">
        <thead>
          <tr>
            <AdminTh>Email</AdminTh>
            <AdminTh>Full Name</AdminTh>
            <AdminTh>User ID</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Created</AdminTh>
            <AdminTh className="text-right">Actions</AdminTh>
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <EmptyRow colSpan={6}>
              {search ? `No users match "${search}".` : "No registered users found."}
            </EmptyRow>
          ) : (
            users.map((u) => (
              <AdminTr key={u.id}>
                <AdminTd className="font-medium text-foreground">{u.email}</AdminTd>
                <AdminTd className="text-muted-foreground">{u.fullName ?? "—"}</AdminTd>
                <AdminTd>
                  <Mono className="text-[11px] text-muted-foreground">{u.id}</Mono>
                </AdminTd>
                <AdminTd>
                  <StatusBadge status={u.isSuspended ? "suspended" : "active"} />
                </AdminTd>
                <AdminTd className="text-muted-foreground">
                  {u.createdAt.toLocaleDateString()}
                </AdminTd>
                <AdminTd className="text-right">
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline"
                    aria-label={`Inspect user ${u.email}`}
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
