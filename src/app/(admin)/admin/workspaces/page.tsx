import "server-only";
import * as React from "react";
import Link from "next/link";
import { Building2, ArrowUpRight } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { searchPlatformWorkspaces } from "@/platform/admin/services/admin-workspaces";

export default async function AdminWorkspacesPage() {
  await requireAdminContext("view:workspaces");
  const workspaces = await searchPlatformWorkspaces();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-rose-400" />
            Workspace Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Tenant directory, subscriptions, ledger inspection, and customer-approved support access.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Workspace Name</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {workspaces.map((ws) => (
              <tr key={ws.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-200">{ws.name}</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-400">{ws.slug}</td>
                <td className="px-4 py-3 font-mono text-slate-300">{ws.defaultCurrency}</td>
                <td className="px-4 py-3">
                  {ws.isSuspended ? (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-semibold uppercase">
                      Suspended
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold uppercase">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {ws.createdAt.toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/workspaces/${ws.id}`}
                    className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 font-medium"
                  >
                    Inspect <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
