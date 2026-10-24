import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FileClock,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttentionItemData } from "@/features/dashboard/api/actions";

const ICONS: Record<AttentionItemData["icon"], LucideIcon> = {
  invoice: AlertTriangle,
  quote: FileCheck2,
  receipt: ReceiptText,
  draft: FileClock,
};

const TONE_STYLES: Record<AttentionItemData["tone"], string> = {
  danger: "border-destructive/25 bg-destructive/5 text-destructive",
  warning: "border-warning/25 bg-warning/5 text-warning",
  info: "border-brand-blue/25 bg-brand-blue/5 text-brand-blue",
  neutral: "border-border bg-muted/40 text-muted-foreground",
};

export function AttentionList({ items }: { items: AttentionItemData[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/5 p-4">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-medium">You&apos;re all caught up</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            There are no overdue invoices, accepted quotes, draft invoices, or receipts waiting for
            review.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className="group flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40 max-sm:p-3.5"
            >
              <span
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg border",
                  TONE_STYLES[item.tone],
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {item.detail}
                </span>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-blue">
                  {item.actionLabel}
                  <ArrowRight className="size-3" aria-hidden />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
