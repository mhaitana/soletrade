export const DOCUMENT_PAGE_SIZE = 25;

// Leave room for the receipt service's maximum batch of 500 when computing
// the inclusive PostgREST range end.
const MAX_OFFSET = Number.MAX_SAFE_INTEGER - 500;

export function normalizeListOffset(offset = 0): number {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_OFFSET ? offset : 0;
}

/** Invalid, repeated, fractional, or unsafe page values start at the first page. */
export function parsePage(value: string | string[] | number | undefined): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) {
    return 1;
  }
  const page = Number(value);
  const offset = (page - 1) * DOCUMENT_PAGE_SIZE;
  return Number.isSafeInteger(page) && page >= 1 && offset <= MAX_OFFSET ? page : 1;
}

export function pageHref(
  pathname: string,
  page: number,
  filters: { status?: string | null; search?: string } = {},
): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.search) query.set("search", filters.search);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `${pathname}?${search}` : pathname;
}
