import "server-only";
import * as React from "react";
import { Flag } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listFeatureFlags } from "@/platform/admin/services/admin-operations";

export default async function AdminFeatureFlagsPage() {
  await requireAdminContext("view:feature_flags");
  const flags = await listFeatureFlags();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Flag className="w-5 h-5 text-rose-400" />
            Platform Feature Flags
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Global rollout toggles and tenant allowlists/blocklists (Phase 7).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Flag Key</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Rollout %</th>
              <th className="px-4 py-3">Allowlisted Workspaces</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {flags.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No feature flags configured.
                </td>
              </tr>
            ) : (
              flags.map((flag) => (
                <tr key={flag.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-200">{flag.key}</td>
                  <td className="px-4 py-3 font-medium text-slate-300">{flag.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{flag.rolloutPercentage}%</td>
                  <td className="px-4 py-3 text-slate-400">
                    {flag.workspaceAllowlist.length > 0
                      ? flag.workspaceAllowlist.join(", ")
                      : "Global"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        flag.enabled
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {flag.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
