import * as React from "react";

import { cn } from "@/shared/lib/utils";

/**
 * <ListRows> — shared wrapper for the divided `<ul>` row lists that were
 * duplicated across customers, files, audit log, and activity feed. Encapsulates
 * the Neutral Pro list chrome: hairline rounded container, divided rows.
 *
 * Presentational only — callers own row content via `renderItem`. Stays an RSC.
 */
export type ListRowsProps<T> = {
  items: T[];
  /** Stable key per item. */
  rowKey: (item: T, index: number) => string;
  /** Renders the inner content of each `<li>`. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Rendered when `items` is empty (replaces the list). */
  emptyState?: React.ReactNode;
  /** Override the default `<li>` padding. */
  liClassName?: string;
  className?: string;
};

export function ListRows<T>({
  items,
  rowKey,
  renderItem,
  emptyState,
  liClassName,
  className,
}: ListRowsProps<T>) {
  if (items.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <ul
      className={cn(
        "overflow-hidden rounded-lg border border-border divide-y divide-border",
        className,
      )}
    >
      {items.map((item, index) => (
        <li key={rowKey(item, index)} className={cn("px-4 py-3", liClassName)}>
          {renderItem(item, index)}
        </li>
      ))}
    </ul>
  );
}