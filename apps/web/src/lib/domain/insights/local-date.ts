import { fiscalQuarter } from "@/lib/domain/books/calc";

/**
 * Calendar helpers for briefings. A briefing's "today" is the workspace's local date, not
 * the server's: at 08:00 in Sydney the UTC date is still yesterday, so an invoice due
 * "today" would otherwise be counted a day late. Pure, so the boundaries can be tested.
 */

/** Space characters `Intl` may put inside a formatted time (narrow and plain no-break). */
const INTL_SPACES = /[  ]/g;

/**
 * The calendar date at `now` in an IANA timezone, as `YYYY-MM-DD`. The timezone is free
 * text on the workspace, so an unknown or missing name falls back to UTC; the timezone
 * actually used is returned so callers format times with the same one.
 */
export function localDate(
  now: Date,
  timezone: string | null | undefined,
): { date: string; timezone: string } {
  const format = (timeZone: string) => ({
    // en-CA renders the date as YYYY-MM-DD.
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
    timezone: timeZone,
  });
  if (timezone) {
    try {
      return format(timezone);
    } catch {
      // Not a timezone this runtime knows: use UTC below.
    }
  }
  return format("UTC");
}

/**
 * "19 Nov, 9:41 am": when a briefing was read, in the workspace's timezone. `timezone`
 * must be a name `localDate` returned, so it is known to be valid.
 */
export function formatAsOf(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(now)
    .replace(INTL_SPACES, " ");
}

/**
 * The financial-year quarter that ended last month, or null in any other month. A briefing
 * mentions an unlodged quarter only during the month after it ends: that is when a GST
 * return is normally prepared, and it keeps a workspace that never marks quarters as
 * lodged from being reminded every day of the year.
 */
export function quarterJustEnded(
  today: string,
  fyStartMonth: number,
): { fiscalYear: number; quarter: number; label: string } | null {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const monthsIntoYear = (month - fyStartMonth + 12) % 12;
  if (monthsIntoYear % 3 !== 0) return null;
  // Day 0 of this month is the last day of the previous one, which is in the ended quarter.
  return fiscalQuarter(new Date(Date.UTC(year, month - 1, 0)), fyStartMonth);
}
