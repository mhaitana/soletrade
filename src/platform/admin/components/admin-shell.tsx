"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldAlert,
  Users,
  Building2,
  CreditCard,
  Tag,
  Coins,
  LifeBuoy,
  KeyRound,
  FileText,
  Flag,
  Webhook,
  ActivitySquare,
  ServerCrash,
  Clock,
} from "lucide-react";
import type { AdminRole, SupportAccessSession } from "@/platform/admin/types";

interface AdminShellProps {
  adminName: string;
  adminEmail: string;
  roles: AdminRole[];
  activeSupportSession?: SupportAccessSession | null;
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: ActivitySquare },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
  { href: "/admin/promotions", label: "Promotions", icon: Tag },
  { href: "/admin/credits", label: "Credit Ledger", icon: Coins },
  { href: "/admin/support", label: "Support Tickets", icon: LifeBuoy },
  { href: "/admin/access-requests", label: "Support Access", icon: KeyRound },
  { href: "/admin/audit", label: "Audit Log", icon: FileText },
  { href: "/admin/feature-flags", label: "Feature Flags", icon: Flag },
  { href: "/admin/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/admin/jobs", label: "Background Jobs", icon: ActivitySquare },
  { href: "/admin/system", label: "System Health", icon: ServerCrash },
];

export function AdminShell({
  adminName,
  adminEmail,
  roles,
  activeSupportSession,
  children,
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100 selection:bg-rose-500 selection:text-white">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/90 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-5 border-b border-slate-800 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold text-sm text-slate-100 tracking-tight">
                Soletrade Operations
              </div>
              <div className="text-[11px] text-rose-400 font-medium uppercase tracking-wider">
                Internal Admin
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Staff footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
          <div className="text-xs font-semibold text-slate-200 truncate">{adminName}</div>
          <div className="text-[11px] text-slate-400 truncate mb-2">{adminEmail}</div>
          <div className="flex flex-wrap gap-1">
            {roles.map((role) => (
              <span
                key={role}
                className="px-1.5 py-0.5 text-[10px] rounded bg-slate-800 text-rose-300 border border-slate-700 font-mono uppercase"
              >
                {role.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Support Access Session Persistent Banner (Principle #15) */}
        {activeSupportSession && (
          <div className="bg-amber-500/15 border-b border-amber-500/40 px-6 py-3 flex items-center justify-between text-amber-200 text-xs">
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <span className="font-semibold text-amber-300">
                  Temporary Customer-Approved Support Access
                </span>
                <span className="mx-2 text-amber-400/60">|</span>
                <span>Workspace: {activeSupportSession.workspaceId}</span>
                <span className="mx-2 text-amber-400/60">|</span>
                <span>Scopes: {activeSupportSession.scopes.join(", ")}</span>
                <span className="mx-2 text-amber-400/60">|</span>
                <span className="font-mono text-amber-300">
                  Expires at {new Date(activeSupportSession.expiresAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                {activeSupportSession.accessLevel}
              </span>
              <button
                type="button"
                className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-medium transition-colors"
              >
                Exit Session
              </button>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
