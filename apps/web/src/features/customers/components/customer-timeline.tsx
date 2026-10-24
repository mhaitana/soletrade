import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatDate, formatMonthYear } from "@/utils/format-date";
import { cn } from "@/lib/utils";
import type { TimelineEntry, TimelineTone } from "@/types/timeline";

/**
 * Customer 360 timeline (Wave 3). Renders a customer's merged invoices/quotes/transactions as a
 * single chronological list with month separators + tone-coded left borders. Server component -
 * no client interactivity (each entry is just a link to its module's detail page).
 *
 * Tone encodes the row's status: positive (paid/accepted/income), negative (void/declined/
 * expense), warning (overdue), neutral (draft/sent/viewed).
 */

const TONE_BORDER: Record<TimelineTone, string> = {
  positive: "border-l-emerald-500 dark:border-l-emerald-500",
  negative: "border-l-rose-500 dark:border-l-rose-500",
  warning: "border-l-amber-500 dark:border-l-amber-500",
  neutral: "border-l-border",
};

const KIND_LABEL: Record<TimelineEntry["kind"], string> = {
  invoice: "Invoice",
  quote: "Quote",
  transaction: "Transaction",
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function CustomerTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">No invoices, quotes, or transactions yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Activity for this customer will appear here as it happens.
        </p>
      </div>
    );
  }

  // Build month groups in the already-desc-sorted order.
  const groups: { label: string; items: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const key = monthKey(entry.date);
    const last = groups[groups.length - 1];
    if (last && monthKey(last.items[0]!.date) === key) {
      last.items.push(entry);
    } else {
      groups.push({ label: formatMonthYear(entry.date), items: [entry] });
    }
  }

  return (
    <div className="space-y-6">
      {groups.map((group, gi) => (
        <div key={`${group.label}-${gi}`} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </h3>
          <div className="overflow-hidden rounded-lg border border-border">
            <ul className="divide-y divide-border">
              {group.items.map((entry) => (
                <li key={`${entry.kind}-${entry.id}`}>
                  <Link
                    href={entry.href}
                    className={cn(
                      "flex items-center gap-3 border-l-2 px-4 py-3 transition-colors hover:bg-muted/40",
                      TONE_BORDER[entry.tone],
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {entry.label}
                        </span>
                        <span className="shrink-0 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
                          {KIND_LABEL[entry.kind]}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">
                        {entry.sublabel}
                      </p>
                    </div>
                    <time
                      dateTime={entry.date.toISOString()}
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >
                      {formatDate(entry.date)}
                    </time>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
