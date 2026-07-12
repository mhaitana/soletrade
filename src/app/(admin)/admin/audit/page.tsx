import "server-only";
import * as React from "react";
import { FileText } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listAdminAuditEvents } from "@/platform/admin/services/admin-audit";

export default async function AdminAuditLogPage() {
  await requireAdminContext("view:audit_logs");
  const events = await listAdminAuditEvents({ limit: 100 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-rose-400" />
            Immutable Admin Audit Log
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Tamper-evident operational trail of all administrative actions (Principle #2 & #5).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Actor Admin ID</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No administrative events recorded yet.
                </td>
              </tr>
            ) : (
              events.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-slate-400 font-mono">
                    {evt.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-200 truncate max-w-[140px]">
                    {evt.actorAdminId}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10px] uppercase text-rose-300">
                    {evt.actorRole.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-100">{evt.action}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {evt.targetType}: {evt.targetId}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{evt.reason ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
