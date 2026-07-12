import "server-only";
import * as React from "react";
import { Webhook } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listWebhookEvents } from "@/platform/admin/services/admin-operations";

export default async function AdminWebhooksPage() {
  await requireAdminContext("view:operations");
  const events = await listWebhookEvents();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Webhook className="w-5 h-5 text-rose-400" />
            Webhook Event Inspector
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Monitor inbound provider notifications and trigger idempotent retries.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Received At</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Event ID</th>
              <th className="px-4 py-3">Event Type</th>
              <th className="px-4 py-3">Attempts</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No webhook events recorded.
                </td>
              </tr>
            ) : (
              events.map((evt) => (
                <tr key={evt.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-slate-400">
                    {evt.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-semibold uppercase text-slate-300">
                    {evt.provider}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{evt.eventId}</td>
                  <td className="px-4 py-3 font-mono text-slate-200">{evt.eventType}</td>
                  <td className="px-4 py-3 text-slate-300">{evt.attempts}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold uppercase">
                      {evt.status}
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
