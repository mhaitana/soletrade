export const periodOptions = [
  { label: "This week", value: "week" },
  { label: "This month", value: "month" },
  { label: "This quarter", value: "quarter" },
  { label: "Current financial year", value: "year" },
  { label: "Calendar year", value: "calendar" },
  { label: "All time", value: "all" },
];
export function periodDates(
  period: string,
  fyStartMonth = 7,
  now = new Date(),
): { dateFrom?: string; dateTo?: string } {
  if (period === "all") return {};
  const year = now.getUTCFullYear(),
    month = now.getUTCMonth();
  let start = new Date(Date.UTC(year, month, 1));
  if (period === "week") {
    start = new Date(Date.UTC(year, month, now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  }
  if (period === "year")
    start = new Date(Date.UTC(month >= fyStartMonth - 1 ? year : year - 1, fyStartMonth - 1, 1));
  if (period === "calendar") start = new Date(Date.UTC(year, 0, 1));
  if (period === "quarter") {
    const offset = (month - (fyStartMonth - 1) + 12) % 12;
    start = new Date(Date.UTC(year, month - (offset % 3), 1));
  }
  return { dateFrom: start.toISOString(), dateTo: now.toISOString() };
}
