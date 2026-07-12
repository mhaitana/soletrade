import "server-only";
import * as React from "react";
import { ActivitySquare } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listBackgroundJobs } from "@/platform/admin/services/admin-operations";

export default async function AdminBackgroundJobsPage() {
  await requireAdminContext("view:operations");
  const jobs = await listBackgroundJobs();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <ActivitySquare className="w-5 h-5 text-rose-400" />
            Background Job Execution Queue
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Monitor worker queues, failures, and execution duration.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Queued At</th>
              <th className="px-4 py-3">Job Name</th>
              <th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3">Duration (ms)</th>
              <th className="px-4 py-3">Attempts</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No background jobs recorded.
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-slate-400">
                    {job.createdAt.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-200">{job.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">{job.queue}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">
                    {job.runTimeMs ? `${job.runTimeMs}ms` : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{job.attempts}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold uppercase">
                      {job.status}
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
