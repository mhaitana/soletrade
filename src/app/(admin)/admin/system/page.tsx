import "server-only";
import * as React from "react";
import { ServerCrash, CheckCircle2 } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { getSystemHealthReport } from "@/platform/admin/services/admin-operations";

export default async function AdminSystemHealthPage() {
  await requireAdminContext("view:system_health");
  const health = await getSystemHealthReport();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <ServerCrash className="w-5 h-5 text-rose-400" />
            System Infrastructure Health
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time status of database instances, Redis queues, and Stripe integration endpoints.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">Database (PostgreSQL / Supabase)</div>
            <div className="text-lg font-bold text-slate-100 mt-1 uppercase">
              {health.database}
            </div>
          </div>
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">Redis & Cache Subsystem</div>
            <div className="text-lg font-bold text-slate-100 mt-1 uppercase">
              {health.redis}
            </div>
          </div>
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400">Stripe Billing Webhooks</div>
            <div className="text-lg font-bold text-slate-100 mt-1 uppercase">
              {health.stripe}
            </div>
          </div>
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
      </div>
    </div>
  );
}
