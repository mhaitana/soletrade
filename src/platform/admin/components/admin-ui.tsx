import * as React from "react";
import type { LucideIcon } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import { Badge, badgeVariants } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

/**
 * Shared admin surface helpers — Neutral Pro themed. Server-component safe
 * (no hooks). Used by every admin page to keep the chrome consistent.
 */

const TH_CLASS =
  "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/30";
const TD_CLASS = "px-4 py-3 align-middle";
const ROW_CLASS = "border-b border-border last:border-0 hover:bg-muted/30 transition-colors";

export function AdminPageHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          <Icon className="size-5 shrink-0 text-brand-blue" />
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function AdminTable({
  children,
  caption,
  className,
}: {
  children: React.ReactNode;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <table className="w-full text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function AdminTh({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th scope="col" className={cn(TH_CLASS, className)}>
      {children}
    </th>
  );
}

export function AdminTd({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={cn(TD_CLASS, className)}>{children}</td>;
}

export function AdminTr({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <tr className={cn(ROW_CLASS, className)}>{children}</tr>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

/**
 * Map a status-ish string to a Badge variant for consistent semantic coloring.
 * - suspended / error / failed / rejected / revoked → destructive
 * - active / healthy / approved / paid / succeeded / completed → success
 * - open / pending / waiting / retry / pending_retry → warning
 * - disabled / archived / closed / cancelled / revoked-inactive → outline
 */
export function statusBadgeVariant(status: string | undefined | null): BadgeVariant {
  if (!status) return "outline";
  const s = String(status).toLowerCase();
  if (
    s === "suspended" ||
    s === "error" ||
    s === "failed" ||
    s === "rejected" ||
    s === "revoked" ||
    s === "cancelled" ||
    s === "voided" ||
    s === "urgent"
  ) {
    return "destructive";
  }
  if (
    s === "active" ||
    s === "healthy" ||
    s === "approved" ||
    s === "paid" ||
    s === "succeeded" ||
    s === "completed" ||
    s === "accepted"
  ) {
    return "success";
  }
  if (
    s === "open" ||
    s === "pending" ||
    s === "waiting_for_support" ||
    s === "waiting" ||
    s === "retry" ||
    s === "pending_retry" ||
    s === "in_progress" ||
    s === "processing" ||
    s === "sent" ||
    s === "overdue" ||
    s === "high"
  ) {
    return "warning";
  }
  return "outline";
}

export function StatusBadge({
  status,
  className,
}: {
  status: string | undefined | null;
  className?: string;
}) {
  return (
    <Badge variant={statusBadgeVariant(status)} className={cn("uppercase text-[10px]", className)}>
      {status ?? "—"}
    </Badge>
  );
}

/** Tabular numerics for money / counts — matches the platform `tabular-nums` rule. */
export function Mono({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn("font-mono tabular-nums", className)} title={title}>
      {children}
    </span>
  );
}
