import "server-only";
import * as React from "react";
import { KeyRound } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { getAdminDb } from "@/platform/admin/services/db";

export default async function AdminAccessRequestsPage() {
  await requireAdminContext("view:support_tickets");
  const db = getAdminDb();

  const [{ data: requests }, { data: sessions }] = await Promise.all([
    db.from("support_access_requests").select("*").order("created_at", { ascending: false }).limit(50),
    db.from("support_access_sessions").select("*").order("starts_at", { ascending: false }).limit(50),
  ]);

  const reqRows = (requests ?? []) as Array<{
    id: string;
    workspace_id: string;
    requested_by_admin_id: string;
    scopes: string[];
    access_level: string;
    reason: string;
    status: string;
    created_at: string;
  }>;

  const sessRows = (sessions ?? []) as Array<{
    id: string;
    workspace_id: string;
    admin_user_id: string;
    scopes: string[];
    access_level: string;
    expires_at: string;
    status: string;
  }>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-rose-400" />
            Temporary Customer-Approved Support Access
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Explicit, time-limited support sessions (Principle #3, #4 & #15). Customer content is strictly isolated outside approved sessions.
          </p>
        </div>
      </div>

      {/* Active & Approved Sessions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Active Support Sessions</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
              <tr>
                <th className="px-4 py-3">Workspace ID</th>
                <th className="px-4 py-3">Admin Staff</th>
                <th className="px-4 py-3">Access Level</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Expires At</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sessRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No active support sessions.
                  </td>
                </tr>
              ) : (
                sessRows.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-slate-200">{s.workspace_id}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{s.admin_user_id}</td>
                    <td className="px-4 py-3 uppercase text-rose-300 font-semibold text-[10px]">
                      {s.access_level}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{s.scopes.join(", ")}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      {new Date(s.expires_at).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px] font-semibold uppercase">
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Access Requests */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">Recent Access Requests</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
              <tr>
                <th className="px-4 py-3">Requested At</th>
                <th className="px-4 py-3">Workspace ID</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {reqRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No support access requests found.
                  </td>
                </tr>
              ) : (
                reqRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-200">{r.workspace_id}</td>
                    <td className="px-4 py-3 text-slate-300">{r.reason}</td>
                    <td className="px-4 py-3 text-slate-400">{r.scopes.join(", ")}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-semibold uppercase">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
