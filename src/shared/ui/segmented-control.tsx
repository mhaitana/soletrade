import * as React from "react";
import Link from "next/link";

import { cn } from "@/shared/lib/utils";

/**
 * SegmentedControl - a single bordered group of mutually-exclusive filter pills
 * (period / status / view). Replaces the ad-hoc `<Link>` pill groups on the
 * dashboard, invoices, quotes, books and drive list pages.
 *
 * Neutral Pro: flat (no shadow), hairline container, active item lifts to card
 * surface with a hairline border; inactive items reserve the same border so
 * toggling never shifts layout.
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

export function SegmentedControl({
  items,
  label,
  className,
}: SegmentedControlProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className="rounded-md outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <span
            className={cn(
              "block rounded-md border px-3 py-1.5 text-xs font-medium transition-colors max-md:min-h-11 max-md:px-4 max-md:py-2.5 max-md:text-sm",
              item.active
                ? "border-border bg-card text-foreground"
                : "border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground",
            )}
          >
            {item.label}
          </span>
        </Link>
      ))}
    </div>
  );
}