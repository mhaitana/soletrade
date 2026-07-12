/**
 * RFC-4180 CSV serialiser (Wave 2 - Drive CSV export). Pure, no deps, no `server-only`.
 * Used by the Drive export route handler (`src/app/api/drive/export/route.ts`) to stream
 * `text/csv`. Server Actions can't stream arbitrary bytes cleanly, so CSV export goes via a
 * route handler - this util is the reusable precedent (future Books ledger / invoice exports
 * can share it).
 *
 * Rules (RFC 4180):
 * - Fields containing a comma, double-quote, or newline are wrapped in double-quotes.
 * - Embedded double-quotes are escaped by doubling (`"` → `""`).
 * - Rows are terminated by CRLF.
 * - A header row is emitted from `columns` (in order) before the data rows.
 */

export interface CsvColumn {
  /** Object key on each row to read the value from. */
  key: string;
  /** Header label for this column. */
  header: string;
}

/** Format a single value for a CSV cell (no quoting applied yet). */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Quote a single field per RFC 4180 if it contains comma, quote, or newline. */
function quoteField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialise an array of row objects into a CSV string. `columns` defines the column order +
 * headers; only those keys are read from each row (extra keys are ignored, missing keys → "").
 * Empty `rows` still emits a header line.
 */
export function toCsv(
  rows: readonly Record<string, unknown>[],
  columns: readonly CsvColumn[],
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => quoteField(c.header)).join(","));
  for (const row of rows) {
    const cells = columns.map((c) => quoteField(formatValue(row[c.key])));
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}
