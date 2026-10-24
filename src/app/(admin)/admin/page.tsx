import "server-only";
import * as React from "react";
import Link from "next/link";
import { brand } from "@/config/brand";
import {
  Building2,
  Users,
  CreditCard,
  LifeBuoy,
  ArrowUpRight,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { listSupportTickets } from "@/platform/admin/services/admin-support";
import { searchPlatformWorkspaces } from "@/platform/admin/services/admin-workspaces";
import { searchPlatformUsers } from "@/platform/admin/services/admin-users";
import {
  getSystemHealthReport,
  type SystemHealthReport,
} from "@/platform/admin/services/admin-operations";
import { listWorkspaceSubscriptions } from "@/platform/admin/services/admin-subscriptions";
import { AdminAuthorizationError } from "@/platform/admin/permissions";
import { AdminPageHeader, StatusBadge, Mono } from "@/platform/admin/components/admin-ui";

/** Best-effort fetch — returns null if the admin lacks permission, so the dashboard
 *  still renders for partial-permission staff (KPIs are supplementary). */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AdminAuthorizationError) return null;
    throw err;
  }
}

function healthSummaryLabel(h: SystemHealthReport | null): {
  label: string;
  variant: "success" | "warning" | "destructive" | "outline";
} {
  if (!h) return { label: "Unknown", variant: "outline" };
  const worst = [h.database, h.redis, h.stripe].reduce<"healthy" | "degraded" | "error">(
    (acc, v) => (v === "error" ? "error" : v === "degraded" && acc !== "error" ? "degraded" : acc),
    "healthy",
  );
  if (worst === "error") return { label: "Error", variant: "destructive" };
  if (worst === "degraded") return { label: "Degraded", variant: "warning" };
  return { label: "Healthy", variant: "success" };
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-4 text-brand-blue" />
      </div>
      <div className="mt-2 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

export default async function AdminDashboardPage() {
  await requireAdminContext();

  const [workspaces, users, tickets, health, subscriptions] = await Promise.all([
    searchPlatformWorkspaces(),
    searchPlatformUsers(),
    listSupportTickets(),
    safe(() => getSystemHealthReport()),
    safe(() => listWorkspaceSubscriptions()),
  ]);

  const openTickets = tickets.filter(
    (t) => t.status === "open" || t.status === "waiting_for_support",
  );
  const activeSubs = (subscriptions ?? []).filter(
    (s) => s.status === "active" || s.status === "trialing",
  );
  const healthState = healthSummaryLabel(health);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Activity}
        title="Platform Operational Dashboard"
        subtitle={`Live operational health, subscription state, and support metrics for ${brand.productName}.`}
        action={<StatusBadge status={healthState.label} className="px-3 py-1" />}
      />

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Active Workspaces"
          value={workspaces.length}
          hint="Managed tenant instances"
          icon={Building2}
        />
        <KpiCard
          label="Registered Users"
          value={users.length}
          hint="Across all workspaces"
          icon={Users}
        />
        <KpiCard
          label="Open Support Tickets"
          value={openTickets.length}
          hint="Requiring support assistance"
          icon={LifeBuoy}
        />
        <KpiCard
          label="Active Subscriptions"
          value={activeSubs.length}
          hint={subscriptions ? "Stripe-reconciled" : "Stripe access unavailable"}
          icon={CreditCard}
        />
      </div>

      {/* Quick Action & Operational Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Support Tickets</h2>
            <Link
              href="/admin/support"
              className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
            >
              View all <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          {tickets.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No active support tickets.
            </p>
          ) : (
            <div className="space-y-2">
              {tickets.slice(0, 5).map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background p-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{ticket.subject}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Requester:{" "}
                      <Mono className="text-muted-foreground">{ticket.requesterUserId}</Mono> |
                      Category: {ticket.category}
                    </div>
                  </div>
                  <StatusBadge status={ticket.status} className="ml-2 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Workspaces</h2>
            <Link
              href="/admin/workspaces"
              className="flex items-center gap-1 text-xs font-medium text-brand-blue hover:underline"
            >
              View all <ArrowUpRight className="size-3.5" />
            </Link>
          </div>

          {workspaces.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No registered workspaces.
            </p>
          ) : (
            <div className="space-y-2">
              {workspaces.slice(0, 5).map((ws) => (
                <div
                  key={ws.id}
                  className="flex items-center justify-between rounded-md border border-border bg-background p-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{ws.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      <Mono>{ws.slug}</Mono> | Currency: {ws.defaultCurrency}
                    </div>
                  </div>
                  <StatusBadge
                    status={ws.isSuspended ? "suspended" : "active"}
                    className="ml-2 shrink-0"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
