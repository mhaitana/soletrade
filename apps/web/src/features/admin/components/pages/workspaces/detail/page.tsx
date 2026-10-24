import "server-only";
import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Coins, KeyRound, ShieldAlert } from "lucide-react";
import { requireAdminContext } from "@/server/application/auth/admin-context";
import { searchPlatformWorkspaces } from "@/server/application/admin/services/admin-workspaces";
import {
  calculateWorkspaceCreditBalance,
  listWorkspaceCreditEntries,
} from "@/server/application/admin/services/admin-credits";
import { StatusBadge, Mono } from "@/features/admin/components/admin-ui";
import { IssueCreditDialog } from "@/features/admin/components/workspaces/detail/issue-credit-dialog";
import { ReverseCreditDialog } from "@/features/admin/components/workspaces/detail/reverse-credit-dialog";
import { RequestAccessDialog } from "@/features/admin/components/workspaces/detail/request-access-dialog";
import { SuspendWorkspaceDialog } from "@/features/admin/components/workspaces/detail/suspend-workspace-dialog";
import { RestoreWorkspaceDialog } from "@/features/admin/components/workspaces/detail/restore-workspace-dialog";

export default async function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  await requireAdminContext("view:workspaces");

  const [workspaces, creditBalanceCents, creditEntries] = await Promise.all([
    searchPlatformWorkspaces(),
    calculateWorkspaceCreditBalance(workspaceId),
    listWorkspaceCreditEntries(workspaceId),
  ]);

  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) {
    notFound();
  }

  const balanceAud = (creditBalanceCents / 100).toFixed(2);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <Link
          href="/admin/workspaces"
          aria-label="Back to workspaces"
          className="rounded-md border border-border bg-card p-2 text-muted-foreground hover:text-foreground hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
            <Building2 className="size-5 shrink-0 text-brand-blue" />
            {workspace.name}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            Slug: <Mono>{workspace.slug}</Mono> | ID: <Mono>{workspace.id}</Mono>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Tenant Operational Overview</h2>
            <dl className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-muted-foreground">Default Currency</dt>
                <dd className="mt-1 text-foreground">
                  <Mono>{workspace.defaultCurrency}</Mono>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner User ID</dt>
                <dd className="mt-1 truncate text-foreground">
                  <Mono>{workspace.ownerUserId}</Mono>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Credit Ledger Balance</dt>
                <dd className="mt-1 font-semibold text-success">
                  <Mono>
                    {balanceAud} {workspace.defaultCurrency}
                  </Mono>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Account Status</dt>
                <dd className="mt-1">
                  <StatusBadge status={workspace.isSuspended ? "suspended" : "active"} />
                </dd>
              </div>
            </dl>
          </div>

          {/* Append-only Credit Ledger Preview (Principle #7 & #12) */}
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Coins className="size-4 text-brand-blue" />
              Append-Only Credit Ledger
            </h2>
            {creditEntries.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No credit adjustments have been applied to this workspace.
              </p>
            ) : (
              <div className="space-y-2">
                {creditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{entry.reason}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        Type: <Mono>{entry.type}</Mono> | Created:{" "}
                        {entry.createdAt.toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Mono
                        className={
                          entry.amountCents >= 0
                            ? "font-semibold text-success"
                            : "font-semibold text-destructive"
                        }
                      >
                        {entry.amountCents >= 0 ? "+" : ""}
                        {(entry.amountCents / 100).toFixed(2)} {entry.currency}
                      </Mono>
                      <ReverseCreditDialog
                        entryId={entry.id}
                        workspaceId={workspaceId}
                        entryReason={entry.reason}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <KeyRound className="size-4 text-brand-blue" />
              Customer-Approved Support Access
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Customer content is protected. Request a time-limited, scoped support session to view
              business content or assist with guided actions.
            </p>
            <RequestAccessDialog workspaceId={workspaceId} workspaceName={workspace.name} />
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldAlert className="size-4 text-brand-blue" />
              Workspace Operations
            </h2>
            <div className="space-y-2 text-xs">
              <IssueCreditDialog workspaceId={workspaceId} workspaceName={workspace.name} />
              {workspace.isSuspended ? (
                <RestoreWorkspaceDialog workspaceId={workspaceId} workspaceName={workspace.name} />
              ) : (
                <SuspendWorkspaceDialog workspaceId={workspaceId} workspaceName={workspace.name} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
