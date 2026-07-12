import "server-only";
import * as React from "react";
import { LifeBuoy } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listSupportTickets } from "@/platform/admin/services/admin-support";

export default async function AdminSupportPage() {
  await requireAdminContext("view:support_tickets");
  const tickets = await listSupportTickets();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-rose-400" />
            Customer Support Queue
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review support cases, prioritize urgency, and request time-limited customer support access.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Requester ID</th>
              <th className="px-4 py-3">Workspace ID</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Support queue is currently empty.
                </td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-200">{t.subject}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                    {t.requesterUserId}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-400">
                    {t.workspaceId ?? "—"}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-300">{t.category}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        t.priority === "urgent" || t.priority === "high"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                          : "bg-slate-800 text-slate-300 border border-slate-700"
                      }`}
                    >
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        t.status === "open"
                          ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {t.status}
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
