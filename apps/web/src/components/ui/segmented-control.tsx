import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * SegmentedControl - a single bordered group of mutually-exclusive filter pills
 * (period / status / view). Replaces the ad-hoc `<Link>` pill groups on the
 * dashboard, invoices, quotes, books and drive list pages.
 *
 * Editorial Precision: Airbnb-style pill track (`rounded-xl bg-muted p-1 border border-border/40`),
 * active item lifts to paper card surface (`rounded-lg bg-card text-foreground shadow-xs font-medium`).
 *
 * Items are link-based (href-driven) so the active state lives in the URL and
 * works without client JS.
 */
export type SegmentedItem = {
  key: string;
  label: React.ReactNode;
  href: string;
  active?: boolean;
};

export type SegmentedControlProps = {
  items: SegmentedItem[];
  /** Accessible name for the group (required - exposes purpose to AT). */
  label: string;
  className?: string;
};

export function SegmentedControl({ items, label, className }: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/40 bg-muted p-1 max-md:max-w-full max-md:flex-nowrap max-md:overflow-x-auto max-md:overscroll-x-contain max-md:snap-x",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className="shrink-0 snap-start rounded-lg outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <span
            className={cn(
              "block rounded-lg px-3 py-1.5 text-xs font-medium transition-all max-md:min-h-11 max-md:px-4 max-md:py-2.5 max-md:text-sm",
              item.active
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:bg-card/50 hover:text-foreground",
            )}
          >
            {item.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
