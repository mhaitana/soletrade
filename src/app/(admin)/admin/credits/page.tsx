import "server-only";
import * as React from "react";
import { Coins } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { getAdminDb } from "@/platform/admin/services/db";

export default async function AdminCreditsPage() {
  await requireAdminContext("view:credits");
  const db = getAdminDb();

  const { data: entries } = await db
    .from("billing_credit_ledger")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (entries ?? []) as Array<{
    id: string;
    workspace_id: string;
    amount_cents: number;
    currency: string;
    type: string;
    reason: string;
    created_at: string;
  }>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Coins className="w-5 h-5 text-rose-400" />
            Append-Only Credit Ledger
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Global immutable audit trail for workspace credit adjustments (Principle #7 & #12).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Workspace ID</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No ledger adjustments recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-200">{entry.workspace_id}</td>
                  <td className="px-4 py-3 font-mono text-[11px] uppercase text-rose-300">
                    {entry.type}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{entry.reason}</td>
                  <td
                    className={`px-4 py-3 font-mono font-semibold text-right ${
                      entry.amount_cents >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {entry.amount_cents >= 0 ? "+" : ""}
                    {(entry.amount_cents / 100).toFixed(2)} {entry.currency}
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
