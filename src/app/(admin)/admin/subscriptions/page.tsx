import "server-only";
import * as React from "react";
import { CreditCard } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listWorkspaceSubscriptions } from "@/platform/admin/services/admin-subscriptions";

export default async function AdminSubscriptionsPage() {
  await requireAdminContext("view:subscriptions");
  const subscriptions = await listWorkspaceSubscriptions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-rose-400" />
            Subscription & Billing Administration
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Monitor Stripe-reconciled subscriptions across all tenant workspaces (Principle #6 & #11).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Workspace ID</th>
              <th className="px-4 py-3">Stripe Customer</th>
              <th className="px-4 py-3">Stripe Sub ID</th>
              <th className="px-4 py-3">Anchor Module</th>
              <th className="px-4 py-3">Interval</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {subscriptions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No active Stripe subscriptions found.
                </td>
              </tr>
            ) : (
              subscriptions.map((sub) => (
                <tr key={sub.workspaceId} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-slate-200">{sub.workspaceId}</td>
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {sub.stripeCustomerId ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {sub.stripeSubscriptionId ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-300">
                    {sub.anchorModuleKey ?? "None"}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-400">
                    {sub.billingInterval ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold uppercase">
                      {sub.status}
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
