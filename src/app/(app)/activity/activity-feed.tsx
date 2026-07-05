import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Trash2, UserPlus, type LucideIcon } from "lucide-react";
import { describeActivity, type ActivityTone } from "@/platform/activity/labels";
import { formatRelativeTime } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import type { ActivityRow } from "@/platform/activity";

const TONE_ICON: Record<ActivityTone, LucideIcon> = {
  positive: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  danger: Trash2,
  neutral: UserPlus,
};

const TONE_ICON_CLASS: Record<ActivityTone, string> = {
  positive: "text-emerald-600 dark:text-emerald-500",
  info: "text-brand-blue",
  warning: "text-amber-600 dark:text-amber-500",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

function actorLabel(row: ActivityRow): string {
  if (!row.actorUserId) return "System";
  return row.actorFullName || row.actorEmail || "Someone";
}

/** Build a deep link to the entity referenced by an activity row, if any. */
function entityHref(row: ActivityRow): string | null {
  if (!row.entityType || !row.entityId) return null;
  if (row.entityType === "customer") return `/customers/${row.entityId}/edit`;
  return null;
}

function ActivityItem({ row }: { row: ActivityRow }) {
  const { label, tone } = describeActivity(row.type);
  const Icon = TONE_ICON[tone];
  const href = entityHref(row);
  const meta = row.metadata as { name?: string } | null;
  const subject = meta?.name ? ` · ${meta.name}` : "";

  const body = (
    <>
      <span className="font-medium text-foreground">{actorLabel(row)}</span>{" "}
      <span className="text-muted-foreground">{label}</span>
      {subject ? <span className="text-muted-foreground">{subject}</span> : null}
    </>
  );

  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_ICON_CLASS[tone])} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        {href ? (
          <Link href={href} className="hover:underline focus-visible:underline">
            {body}
          </Link>
        ) : (
          <p>{body}</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          <time dateTime={row.createdAt.toISOString()}>{formatRelativeTime(row.createdAt)}</time>
        </p>
      </div>
    </li>
  );
}

export function ActivityFeed({ items }: { items: ActivityRow[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">No activity yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Actions like adding a customer or enabling a module will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <ul className="divide-y divide-border px-4">
        {items.map((row) => (
          <ActivityItem key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}
