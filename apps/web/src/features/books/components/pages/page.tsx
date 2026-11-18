import Link from "next/link";
import { Download, FileText, Landmark, Plus, ScanLine, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ResponsiveFilter } from "@/components/ui/responsive-filter";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { ListPagination } from "@/components/list-pagination";
import { formatCents } from "@/lib/domain/billing/pricing";
import { formatDate } from "@/utils/format-date";
import { categoryLabel } from "@/config/books-categories";
import { PERIODS, parsePeriod, type Period } from "@/utils/periods";
import { RECORD_PAGE_SIZE, pageHref, parsePage } from "@/utils/pagination";
import { loadBooksPage } from "@/features/books/api/actions";
import { BooksSummary } from "@/features/books/components/books-summary";
import type { BookType } from "@/lib/domain/database-enums";

export const metadata = { title: "Books" };

const TYPE_FILTERS: { key: "all" | BookType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "income", label: "Income" },
  { key: "expense", label: "Expense" },
];

const TYPE_BADGE: Record<BookType, { label: string; variant: "default" | "destructive" }> = {
  income: { label: "Income", variant: "default" },
  expense: { label: "Expense", variant: "destructive" },
};

/** Build a `/books` href preserving the active period + type + search across filter links. */
function hrefWith(
  patch: { type?: "all" | BookType; period?: Period },
  current: { type: BookType | null; search: string; period: Period },
): string {
  const params = new URLSearchParams();
  const nextType = patch.type ?? "all";
  if (nextType !== "all") params.set("type", nextType);
  if (current.search) params.set("search", current.search);
  if (patch.period) {
    if (patch.period !== "year") params.set("period", patch.period);
  } else if (current.period !== "year") {
    params.set("period", current.period);
  }
  const qs = params.toString();
  return qs ? `/books?${qs}` : "/books";
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string | string[];
    search?: string | string[];
    period?: string | string[];
    page?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const rawType = typeof sp.type === "string" ? sp.type : undefined;
  const rawSearch = typeof sp.search === "string" ? sp.search : undefined;
  const rawPeriod = typeof sp.period === "string" ? sp.period : undefined;
  const type = rawType === "income" || rawType === "expense" ? (rawType as BookType) : undefined;
  const period = parsePeriod(rawPeriod);
  const data = await loadBooksPage({
    type,
    search: rawSearch,
    period,
    page: parsePage(sp.page, RECORD_PAGE_SIZE),
  });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;

  const current = { type: data.typeFilter, search: data.search, period: data.period };
  // Page links keep the active filters; "year" is the default period and stays implicit.
  const pageFilters = {
    type: data.typeFilter,
    search: data.search,
    period: data.period !== "year" ? data.period : null,
  };
  const periodFilterItems = PERIODS.map((option) => ({
    key: option.key,
    label: option.label,
    href: hrefWith({ period: option.key }, current),
    active: option.key === data.period,
  }));
  const typeFilterItems = TYPE_FILTERS.map((option) => ({
    key: option.key,
    label: option.label,
    href: hrefWith({ type: option.key }, current),
    active: (option.key === "all" && !type) || option.key === type,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Books</h1>
          <p className="text-sm text-muted-foreground">Track income, expenses, and receipts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/books/receipts">
              <ScanLine className="size-4" aria-hidden />
              Receipts
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/books/tax">
              <Landmark className="size-4" aria-hidden />
              GST / BAS
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/books/report?period=${data.period}`}>
              <FileText className="size-4" aria-hidden />
              P&amp;L PDF
            </Link>
          </Button>
          {data.canManage ? (
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/api/books/export?period=${data.period}&type=${data.typeFilter ?? "all"}`}
              >
                <Download className="size-4" aria-hidden />
                CSV
              </Link>
            </Button>
          ) : null}
          {data.canManage ? (
            <Button asChild>
              <Link href="/books/new">
                <Plus className="size-4" aria-hidden />
                New transaction
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2" aria-label="Filters">
        <ResponsiveFilter label="Filter transactions by period" items={periodFilterItems} />
        <ResponsiveFilter label="Filter transactions by type" items={typeFilterItems} />
      </div>

      <form
        action="/books"
        method="get"
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        {type ? <input type="hidden" name="type" value={type} /> : null}
        {data.period !== "year" ? <input type="hidden" name="period" value={data.period} /> : null}
        <Input
          type="search"
          name="search"
          defaultValue={data.search}
          placeholder="Search by description or customer"
          className="min-w-0 flex-1 sm:max-w-sm"
          aria-label="Search transactions"
        />
        <Button
          type="submit"
          variant="outline"
          className="px-3 max-sm:size-11 max-sm:px-0"
          aria-label="Search transactions"
        >
          <Search className="size-4" aria-hidden />
          <span className="max-sm:sr-only">Search</span>
        </Button>
        {data.search || type || data.period !== "year" ? (
          <Button asChild variant="ghost">
            <Link href="/books">Clear</Link>
          </Button>
        ) : null}
      </form>

      <BooksSummary summary={data.summary} currency={data.currency} period={data.period} />

      {data.transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {data.page > 1
              ? "No transactions on this page."
              : data.search || type
                ? "No transactions match your filters."
                : "No transactions yet."}
          </p>
          {data.page > 1 ? (
            <p className="mt-1 text-sm">
              <Link
                href={pageHref("/books", 1, pageFilters)}
                className="text-primary hover:underline"
              >
                Return to first page
              </Link>
            </p>
          ) : data.canManage && !data.search && !type ? (
            <p className="mt-1 text-sm">
              <Link href="/books/new" className="text-primary hover:underline">
                Record your first transaction
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Date
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Description
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Category
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Type
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.transactions.map((tx) => {
                const badge = TYPE_BADGE[tx.type];
                const label = categoryLabel(tx.type, tx.category);
                const signed = tx.type === "income" ? tx.amountCents : -tx.amountCents;
                return (
                  <tr key={tx.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(tx.date)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/books/${tx.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {tx.description}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{label ?? tx.category}</td>
                    <td className="px-4 py-3">
                      {tx.customerName ? (
                        <span className="text-foreground">{tx.customerName}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${
                        tx.type === "income"
                          ? "text-emerald-600 dark:text-emerald-500"
                          : "text-foreground"
                      }`}
                    >
                      {formatCents(signed, tx.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ListPagination
        pathname="/books"
        page={data.page}
        hasNext={data.hasNext}
        filters={pageFilters}
      />
    </div>
  );
}
