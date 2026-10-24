import "server-only";
import * as React from "react";
import Link from "next/link";
import { brand } from "@/config/brand";
import { notFound } from "next/navigation";
import { ArrowLeft, User, ShieldAlert, Lock } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { searchPlatformUsers } from "@/platform/admin/services/admin-users";
import { StatusBadge, Mono } from "@/platform/admin/components/admin-ui";
import { SuspendUserDialog } from "./suspend-user-dialog";
import { RestoreUserDialog } from "./restore-user-dialog";

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  await requireAdminContext("view:users");

  const users = await searchPlatformUsers();
  const user = users.find((u) => u.id === userId);

  if (!user) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Link
          href="/admin/users"
          aria-label="Back to users"
          className="rounded-md border border-border bg-card p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <User className="size-5 shrink-0 text-brand-blue" />
            {user.fullName || user.email}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            User ID: <Mono>{user.id}</Mono>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Account Operational Metadata</h2>
            <dl className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-muted-foreground">Email Address</dt>
                <dd className="mt-1 font-medium text-foreground">{user.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Account Status</dt>
                <dd className="mt-1">
                  <StatusBadge status={user.isSuspended ? "suspended" : "active"} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Registration Date</dt>
                <dd className="mt-1 text-foreground">{user.createdAt.toLocaleString()}</dd>
              </div>
            </dl>
          </div>

          {/* Principle #3 / #4 Customer Content Isolation Banner */}
          <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 p-5 text-xs text-warning">
            <div className="flex items-center gap-2 font-semibold">
              <Lock className="size-4" />
              Customer Business Content Protected
            </div>
            <p className="leading-relaxed text-warning/80">
              In accordance with {brand.productName} Principle #3 and #4, customer invoices, quotes,
              accounting transactions, files, and AI conversations are inaccessible from this view.
              To inspect business content, the customer must grant an explicit time-limited Support
              Access Session.
            </p>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert className="size-4 text-brand-blue" />
              Permissioned Account Actions
            </h2>
            <div className="space-y-2 text-xs">
              <button
                type="button"
                disabled
                className="min-h-11 w-full cursor-not-allowed rounded-md border border-border bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground/60 md:min-h-0"
                title="Not yet implemented — requires its own RBAC + audit path."
              >
                Revoke User Sessions
                <span className="ml-1 text-[10px]">(coming soon)</span>
              </button>
              {user.isSuspended ? (
                <RestoreUserDialog userId={user.id} userName={user.fullName || user.email} />
              ) : (
                <SuspendUserDialog userId={user.id} userName={user.fullName || user.email} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
