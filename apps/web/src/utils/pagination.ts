export const DOCUMENT_PAGE_SIZE = 25;
/** Page size for ledger-style lists (Books transactions, Drive entries, customers). */
export const RECORD_PAGE_SIZE = 50;

// Leave room for the receipt service's maximum batch of 500 when computing
// the inclusive PostgREST range end.
const MAX_OFFSET = Number.MAX_SAFE_INTEGER - 500;

export function normalizeListOffset(offset = 0): number {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= MAX_OFFSET ? offset : 0;
}

/** Invalid, repeated, fractional, or unsafe page values start at the first page. */
export function parsePage(
  value: string | string[] | number | undefined,
  pageSize: number = DOCUMENT_PAGE_SIZE,
): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) {
    return 1;
  }
  const page = Number(value);
  const offset = (page - 1) * pageSize;
  return Number.isSafeInteger(page) && page >= 1 && offset <= MAX_OFFSET ? page : 1;
}

/** Query values a list page keeps across its page links; empty values are left out. */
export type PageFilters = Readonly<Record<string, string | null | undefined>>;

export function pageHref(pathname: string, page: number, filters: PageFilters = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `${pathname}?${search}` : pathname;
}
