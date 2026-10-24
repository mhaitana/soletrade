import * as React from "react";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type ResponsiveFilterItem = {
  key: string;
  label: string;
  href: string;
  active?: boolean;
  download?: boolean;
};

type CollapseBreakpoint = "md" | "xl";

const VISIBILITY: Record<CollapseBreakpoint, { menu: string; segmented: string }> = {
  md: {
    menu: "md:hidden",
    segmented: "hidden md:block",
  },
  xl: {
    menu: "xl:hidden",
    segmented: "hidden xl:block",
  },
};

export function FilterMenu({
  items,
  label,
  triggerLabel,
  align = "start",
}: {
  items: ResponsiveFilterItem[];
  label: string;
  triggerLabel?: string;
  align?: "start" | "end";
}) {
  const activeLabel = items.find((item) => item.active)?.label ?? items[0]?.label ?? "Filter";
  const visibleLabel = triggerLabel ?? activeLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-11 max-w-48 min-w-0 justify-between gap-2 px-3"
          aria-label={`${label}: ${visibleLabel}`}
        >
          <span className="truncate">{visibleLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-48">
        {items.map((item) => {
          const content = (
            <>
              <span>{item.label}</span>
              {item.active ? <Check className="ml-auto size-4" aria-hidden /> : null}
            </>
          );

          return (
            <DropdownMenuItem key={item.key} asChild className="min-h-11 px-3">
              {item.download ? (
                <a href={item.href} download aria-current={item.active ? "page" : undefined}>
                  {content}
                </a>
              ) : (
                <Link href={item.href} aria-current={item.active ? "page" : undefined}>
                  {content}
                </Link>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ResponsiveFilter({
  items,
  label,
  collapseBelow = "md",
  menuAlign,
  className,
}: {
  items: ResponsiveFilterItem[];
  label: string;
  collapseBelow?: CollapseBreakpoint;
  menuAlign?: "start" | "end";
  className?: string;
}) {
  const visibility = VISIBILITY[collapseBelow];

  return (
    <div className={cn("min-w-0", className)}>
      <div className={visibility.menu}>
        <FilterMenu items={items} label={label} align={menuAlign} />
      </div>
      <div className={visibility.segmented}>
        <SegmentedControl label={label} items={items} />
      </div>
    </div>
  );
}

export function CollapsibleLinkMenu({
  items,
  label,
  triggerLabel,
  collapseBelow = "md",
  align,
  className,
}: {
  items: ResponsiveFilterItem[];
  label: string;
  triggerLabel: string;
  collapseBelow?: CollapseBreakpoint;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <div className={cn(VISIBILITY[collapseBelow].menu, className)}>
      <FilterMenu items={items} label={label} triggerLabel={triggerLabel} align={align} />
    </div>
  );
}
