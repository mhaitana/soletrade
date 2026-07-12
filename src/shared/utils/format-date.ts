/**
 * Shared date formatter (Phase 9). Extracted from the identical 4-line `formatDate` duplicated
 * across the Books / Drive / Invoices / Quotes page + detail pages (7 copies). Pure - no
 * `server-only`, no DB - so it's unit-testable and importable from server components.
 *
 * Renders `null` as an em dash (matching the established convention for "no date" in this
 * codebase). Uses the host locale via `toLocaleDateString` with a `year, month, day` format.
 */
export function formatDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Format the Monday anchoring a week as a "Week of 6 Jul" label (Wave 2 - Drive weekly
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
 * Format a date's month + year as a "July 2026" label (Wave 3 - customer timeline month
 * separators). Pure. Uses the host locale via `toLocaleDateString`.
 */
export function formatMonthYear(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Format a date in a specific IANA timezone (Wave 4 - workspace `timezone` setting). Pure.
 * Stored dates stay UTC; this only affects display. Uses `Intl.DateTimeFormat` with the
 * workspace's `timeZone` so a 2026-07-06 UTC date renders as "Jul 6, 2026" in
 * Australia/Sydney but "Jul 5, 2026" in America/Los_Angeles. Falls back to the host locale
 * + UTC if the timezone is invalid (guarded - an invalid zone would otherwise throw).
 *
 * Use this for the most-visible surfaces (dashboard, invoice/quote lists) where the
 * workspace's timezone should drive the rendered day. `formatDate` (host locale) stays
 * the default for surfaces where the exact TZ doesn't matter.
 */
export function formatDateInTz(d: Date | null, timezone: string): string {
  if (!d) return "-";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: timezone,
    }).format(d);
  } catch {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
}
