import "server-only";
import * as React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Coins, KeyRound, ShieldAlert } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { searchPlatformWorkspaces } from "@/platform/admin/services/admin-workspaces";
import {
  calculateWorkspaceCreditBalance,
  listWorkspaceCreditEntries,
} from "@/platform/admin/services/admin-credits";

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
      <div className="flex items-center gap-4 border-b border-slate-800 pb-4">
        <Link
          href="/admin/workspaces"
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-rose-400" />
            {workspace.name}
          </h1>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Slug: {workspace.slug} | ID: {workspace.id}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200">Tenant Operational Overview</h2>
            <dl className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <dt className="text-slate-400">Default Currency</dt>
                <dd className="text-slate-200 font-mono mt-1">{workspace.defaultCurrency}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Owner User ID</dt>
                <dd className="text-slate-200 font-mono mt-1 truncate">{workspace.ownerUserId}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Current Credit Ledger Balance</dt>
                <dd className="text-emerald-400 font-semibold font-mono mt-1">
                  ${balanceAud} {workspace.defaultCurrency}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Account Status</dt>
                <dd className="mt-1">
                  {workspace.isSuspended ? (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 font-semibold uppercase text-[10px]">
                      Suspended
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold uppercase text-[10px]">
                      Active
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Append-only Credit Ledger Preview (Principle #7 & #12) */}
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Coins className="w-4 h-4 text-rose-400" />
                Append-Only Credit Ledger
              </h2>
            </div>
            {creditEntries.length === 0 ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                No credit adjustments have been applied to this workspace.
              </div>
            ) : (
              <div className="space-y-2">
                {creditEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-lg border border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-medium text-slate-200">{entry.reason}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        Type: {entry.type} | Created: {entry.createdAt.toLocaleDateString()}
                      </div>
                    </div>
                    <div
                      className={`font-mono font-semibold ${
                        entry.amountCents >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {entry.amountCents >= 0 ? "+" : ""}
                      {(entry.amountCents / 100).toFixed(2)} {entry.currency}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-rose-400" />
              Customer-Approved Support Access
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Customer content is protected. Request a time-limited, scoped support session to view business content or assist with guided actions.
            </p>
            <Link
              href="/admin/access-requests"
              className="block text-center py-2 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 font-medium border border-rose-500/30 text-xs transition-colors"
            >
              Request Support Access Session
            </Link>
          </div>

          <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              Workspace Operations
            </h2>
            <div className="space-y-2 text-xs">
              <button
                type="button"
                className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium border border-slate-700 text-left transition-colors"
              >
                Apply Workspace Credit Ledger Entry...
              </button>
              <button
                type="button"
                className="w-full py-2 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-medium border border-rose-500/30 text-left transition-colors"
              >
                {workspace.isSuspended ? "Restore Workspace..." : "Suspend Workspace..."}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
