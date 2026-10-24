"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert, Clock } from "lucide-react";
import type { AdminRole, SupportAccessSession } from "@/lib/domain/admin/types/index";
import { NAV_GROUPS, isAdminItemActive } from "@/features/admin/components/admin-nav";
import { AdminMobileNav } from "@/features/admin/components/admin-mobile-nav";
import { ExitSessionButton } from "@/features/admin/components/exit-session-button";
import { AdminSignOutButton } from "@/features/admin/components/admin-sign-out-button";

interface AdminShellProps {
  signOutAction: () => Promise<void>;
  adminName: string;
  adminEmail: string;
  roles: AdminRole[];
  activeSupportSession?: SupportAccessSession | null;
  children: React.ReactNode;
}

function roleLabel(role: AdminRole): string {
  return role.replace(/_/g, " ");
}

export function AdminShell({
  signOutAction,
  adminName,
  adminEmail,
  roles,
  activeSupportSession,
  children,
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh bg-background text-foreground selection:bg-brand-blue selection:text-white">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-border bg-sidebar lg:flex">
        <div className="overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-border p-5">
            <div className="rounded-lg border border-brand-blue/30 bg-brand-blue/10 p-2 text-brand-blue">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                Soletrade Operations
              </div>
              <div className="text-[11px] font-medium uppercase tracking-wider text-brand-blue">
                Internal Admin
              </div>
            </div>
          </div>

          <nav className="p-3" aria-label="Admin navigation">
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="mb-4">
                <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = isAdminItemActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "border border-brand-blue/30 bg-brand-blue/10 text-brand-blue"
                            : "border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <Icon className="size-4 shrink-0" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Staff footer */}
        <div className="border-t border-border p-4">
          <div className="truncate text-xs font-semibold text-foreground">{adminName}</div>
          <div className="mb-2 truncate text-[11px] text-muted-foreground">{adminEmail}</div>
          <div className="flex flex-wrap gap-1">
            {roles.map((role) => (
              <span
                key={role}
                className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase text-brand-blue"
              >
                {roleLabel(role)}
              </span>
            ))}
          </div>
          <AdminSignOutButton
            signOutAction={signOutAction}
            className="mt-3 w-full justify-center gap-2"
          />
        </div>
      </aside>

      {/* Main container */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-border bg-sidebar px-4 py-3 lg:hidden">
          <AdminMobileNav signOutAction={signOutAction} />
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-brand-blue/30 bg-brand-blue/10 p-1 text-brand-blue">
              <ShieldAlert className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">Soletrade Operations</span>
          </div>
        </div>

        {/* Support Access Session persistent banner (Principle #15) */}
        {activeSupportSession ? (
          <div className="flex flex-col gap-2 border-b border-warning/40 bg-warning/10 px-4 py-3 text-xs text-warning sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-start gap-3 sm:items-center">
              <Clock className="size-4 shrink-0 text-warning" />
              <div className="space-y-0.5 sm:flex sm:items-center sm:gap-2 sm:space-y-0">
                <span className="font-semibold text-warning">Customer-approved support access</span>
                <span className="text-warning/70 sm:mx-1">·</span>
                <span>
                  Workspace: <span className="font-mono">{activeSupportSession.workspaceId}</span>
                </span>
                <span className="text-warning/70 sm:mx-1">·</span>
                <span>Scopes: {activeSupportSession.scopes.join(", ")}</span>
                <span className="text-warning/70 sm:mx-1">·</span>
                <span className="font-mono text-warning">
                  Expires {new Date(activeSupportSession.expiresAt).toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded border border-warning/40 bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                {activeSupportSession.accessLevel.replace(/_/g, " ")}
              </span>
              <ExitSessionButton sessionId={activeSupportSession.id} />
            </div>
          </div>
        ) : null}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
