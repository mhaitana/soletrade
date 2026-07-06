import { ShieldCheck } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import type { AuditRow } from "@/platform/audit";

function actorLabel(row: AuditRow): string {
  if (!row.actorUserId) return "System";
  return row.actorFullName || row.actorEmail || "Someone";
}

function AuditItem({ row }: { row: AuditRow }) {
  const meta = row.metadata as { from?: string; to?: string } | null;
  const roleChange =
    meta?.from && meta?.to ? (
      <span className="text-muted-foreground">
        {" "}
        ({meta.from} → {meta.to})
      </span>
    ) : null;

  return (
    <li className="flex items-start gap-3 py-3">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p>
          <span className="font-medium text-foreground">{actorLabel(row)}</span>{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {row.action}
          </code>
          {row.targetType ? (
            <span className="text-muted-foreground">
              {" "}
              · {row.targetType}
              {row.targetId ? ` ${row.targetId.slice(0, 8)}` : ""}
            </span>
          ) : null}
          {roleChange}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <time dateTime={row.createdAt.toISOString()}>{formatRelativeTime(row.createdAt)}</time>
          {row.ip ? <span className="ml-2">· IP {row.ip}</span> : null}
        </p>
      </div>
    </li>
  );
}

export function AuditFeed({ items }: { items: AuditRow[] }) {
  if (items.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed border-border p-8 text-center")}>
        <p className="text-sm text-muted-foreground">No audit entries yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Sensitive mutations — billing, members, modules — are recorded here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <ul className="divide-y divide-border px-4">
        {items.map((row) => (
          <AuditItem key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}
