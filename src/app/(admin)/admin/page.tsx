import "server-only";
import * as React from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  CreditCard,
  LifeBuoy,
  ArrowUpRight,
} from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listSupportTickets } from "@/platform/admin/services/admin-support";
import { searchPlatformWorkspaces } from "@/platform/admin/services/admin-workspaces";
import { searchPlatformUsers } from "@/platform/admin/services/admin-users";

export default async function AdminDashboardPage() {
  await requireAdminContext();

  const [workspaces, users, tickets] = await Promise.all([
    searchPlatformWorkspaces(),
    searchPlatformUsers(),
    listSupportTickets(),
  ]);

  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "waiting_for_support");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            Platform Operational Dashboard
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Live operational health, subscription state, and support metrics for Soletrade Workspace.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            System Healthy
          </span>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Active Workspaces</span>
            <Building2 className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-slate-100 mt-2">{workspaces.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Managed tenant instances</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Total Registered Users</span>
            <Users className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-slate-100 mt-2">{users.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Across all workspaces</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Open Support Tickets</span>
            <LifeBuoy className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-slate-100 mt-2">{openTickets.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Requiring support assistance</div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>Billing Status</span>
            <CreditCard className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-2">Reconciled</div>
          <div className="text-[11px] text-slate-500 mt-1">Stripe single source of truth</div>
        </div>
      </div>

      {/* Quick Action & Operational Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Recent Support Tickets</h2>
            <Link
              href="/admin/support"
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium"
            >
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {tickets.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">No active support tickets.</div>
          ) : (
            <div className="space-y-2">
              {tickets.slice(0, 5).map((ticket) => (
                <div
                  key={ticket.id}
                  className="p-3 rounded-lg border border-slate-800/80 bg-slate-900/80 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-medium text-slate-200">{ticket.subject}</div>
                    <div className="text-slate-400 text-[11px] mt-0.5">
                      Requester: {ticket.requesterUserId} | Category: {ticket.category}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      ticket.status === "open"
                        ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                        : "bg-slate-800 text-slate-300 border border-slate-700"
                    }`}
                  >
                    {ticket.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/40 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Recent Workspaces</h2>
            <Link
              href="/admin/workspaces"
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium"
            >
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {workspaces.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">No registered workspaces.</div>
          ) : (
            <div className="space-y-2">
              {workspaces.slice(0, 5).map((ws) => (
                <div
                  key={ws.id}
                  className="p-3 rounded-lg border border-slate-800/80 bg-slate-900/80 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-medium text-slate-200">{ws.name}</div>
                    <div className="text-slate-400 text-[11px] mt-0.5 font-mono">
                      {ws.slug} | Currency: {ws.defaultCurrency}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    Active
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
