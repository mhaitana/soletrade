import * as React from "react";

import { cn } from "@/shared/lib/utils";

/**
 * <DataTable> - shared presentational wrapper for the list/detail tables that
 * were copy-pasted across invoices, quotes, books, drive, and the billing
 * ledger. Encapsulates the Neutral Pro table chrome: hairline container,
 * uppercase muted header, divided rows, hover state. Numeric columns render in
 * JetBrains Mono with tabular figures and right alignment so amounts line up.
 *
 * Presentational only - callers own cell content (including any links) via the
 * `cell` callback, so this stays an RSC and never needs client JS.
 */
export type Column<T> = {
  /** Header cell content. */
  header: React.ReactNode;
  /** Cell renderer for this column. */
  cell: (row: T, index: number) => React.ReactNode;
  /** Extra classes for both `<th>` and `<td>` in this column. */
  className?: string;
  /** Numeric columns get `font-mono text-right tabular-nums`. */
  numeric?: boolean;
};

export type DataTableProps<T> = {
  columns: Column<T>[];
  rows: T[];
  /** Stable key per row (React key + a11y). */
  rowKey: (row: T, index: number) => string;
  /** Rendered when `rows` is empty (replaces the table). */
  emptyState?: React.ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyState,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border border-border",
        className,
      )}
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((col, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "px-4 py-2.5 font-medium",
                  col.numeric && "text-right font-mono",
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className="transition-colors hover:bg-muted/40"
            >
              {columns.map((col, i) => (
                <td
                  key={i}
                  className={cn(
                    "px-4 py-3 align-middle",
                    col.numeric && "text-right font-mono tabular-nums",
                    col.className,
                  )}
                >
                  {col.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}