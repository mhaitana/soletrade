import "server-only";
import * as React from "react";
import { ServerCrash, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { requireAdminContext } from "@/platform/admin/services/admin-auth";
import { getSystemHealthReport } from "@/platform/admin/services/admin-operations";
import { AdminPageHeader, StatusBadge, Mono } from "@/platform/admin/components/admin-ui";

type HealthValue = "healthy" | "degraded" | "error";

function healthVisual(v: HealthValue): {
  Icon: React.ComponentType<{ className?: string }>;
  className: string;
} {
  if (v === "error") return { Icon: XCircle, className: "text-destructive" };
  if (v === "degraded") return { Icon: AlertTriangle, className: "text-warning" };
  return { Icon: CheckCircle2, className: "text-success" };
}

function HealthCard({ label, value }: { label: string; value: HealthValue }) {
  const { Icon, className } = healthVisual(value);
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-5">
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 uppercase text-foreground">
          <StatusBadge status={value} />
        </div>
      </div>
      <Icon className={`size-6 ${className}`} aria-hidden />
    </div>
  );
}

export default async function AdminSystemHealthPage() {
  await requireAdminContext("view:system_health");
  const health = await getSystemHealthReport();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={ServerCrash}
        title="System Infrastructure Health"
        subtitle="Real-time status of database instances, Redis queues, and Stripe integration endpoints."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HealthCard label="Database (PostgreSQL / Supabase)" value={health.database} />
        <HealthCard label="Redis & Cache Subsystem" value={health.redis} />
        <HealthCard label="Stripe Billing Webhooks" value={health.stripe} />
      </div>

      <div className="rounded-lg border border-border bg-card p-5 text-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Error rate</dt>
            <dd className="mt-1 text-foreground">
              <Mono className="tabular-nums">{health.errorRatePercent.toFixed(2)}%</Mono>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last checked</dt>
            <dd className="mt-1 text-foreground">
              <Mono className="tabular-nums">{health.checkedAt.toLocaleString()}</Mono>
            </dd>
          </div>
        </div>
      </div>
    </div>
  );
}
