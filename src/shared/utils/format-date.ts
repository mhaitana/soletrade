/**
 * Shared date formatter (Phase 9). Extracted from the identical 4-line `formatDate` duplicated
 * across the Books / Drive / Invoices / Quotes page + detail pages (7 copies). Pure — no
 * `server-only`, no DB — so it's unit-testable and importable from server components.
 *
 * Renders `null` as an em dash (matching the established convention for "no date" in this
 * codebase). Uses the host locale via `toLocaleDateString` with a `year, month, day` format.
 */
export function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
