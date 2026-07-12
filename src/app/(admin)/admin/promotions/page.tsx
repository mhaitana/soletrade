import "server-only";
import * as React from "react";
import { Tag } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listPromotions } from "@/platform/admin/services/admin-promotions";

export default async function AdminPromotionsPage() {
  await requireAdminContext("view:subscriptions");
  const promotions = await listPromotions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Tag className="w-5 h-5 text-rose-400" />
            Promotions & Coupons Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Stripe-backed discounts and coupon campaigns (Principle #7).
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
            <tr>
              <th className="px-4 py-3">Promotion Name</th>
              <th className="px-4 py-3">Public Code</th>
              <th className="px-4 py-3">Stripe Coupon ID</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {promotions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No promotional campaigns created yet.
                </td>
              </tr>
            ) : (
              promotions.map((p) => (
                <tr key={p.id} className="hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-200">{p.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-300">
                    {p.publicCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">{p.stripeCouponId}</td>
                  <td className="px-4 py-3 text-slate-200">
                    {p.discountType === "percentage"
                      ? `${p.percentOff}% off`
                      : `$${((p.amountOffCents ?? 0) / 100).toFixed(2)} off`}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-400">{p.duration}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        p.active
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {p.active ? "Active" : "Archived"}
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
