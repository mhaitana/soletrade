/**
 * Generic display formatters. Shared utility — no app/module/platform imports.
 */

/**
 * Format a date as a compact relative phrase: "just now", "3m ago", "2h ago",
 * "5d ago", or a fallback to the locale date for anything older than a week.
 *
 * `now` is injectable for deterministic tests.
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  // Beyond a week, render an absolute date so the timeline stays unambiguous.
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
