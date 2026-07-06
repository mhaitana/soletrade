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

/**
 * Format the Monday anchoring a week as a "Week of 6 Jul" label (Wave 2 — Drive weekly
 * summary + dashboard). Pure. Pass any date within the week; the label always renders the
 * Monday of that week (Australian week starts Monday).
 */
export function formatWeekLabel(withinWeek: Date): string {
  const d = new Date(withinWeek);
  d.setUTCHours(0, 0, 0, 0);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - day); // roll back to this week's Monday
  return `Week of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * Format a date's month + year as a "July 2026" label (Wave 3 — customer timeline month
 * separators). Pure. Uses the host locale via `toLocaleDateString`.
 */
export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
