import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { categoryLabel } from "@/shared/constants/books-categories";
import { loadBooksPage } from "./actions";
import type { BookType } from "@/server/db/schema/enums";

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

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function BooksPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; search?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawType = typeof sp.type === "string" ? sp.type : undefined;
  const rawSearch = typeof sp.search === "string" ? sp.search : undefined;
  const type = rawType === "income" || rawType === "expense" ? (rawType as BookType) : undefined;
  const data = await loadBooksPage({ type, search: rawSearch });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="books" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Books</h1>
          <p className="text-sm text-muted-foreground">Track income, expenses, and receipts.</p>
        </div>
        {data.canManage ? (
          <Button asChild>
            <Link href="/books/new">
              <Plus className="size-4" aria-hidden />
              New transaction
            </Link>
          </Button>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter transactions by type"
      >
        {TYPE_FILTERS.map((f) => {
          const active = (f.key === "all" && !type) || f.key === type;
          const href =
            f.key === "all"
              ? data.search
                ? `/books?search=${encodeURIComponent(data.search)}`
                : "/books"
              : `/books?type=${f.key}${data.search ? `&search=${encodeURIComponent(data.search)}` : ""}`;
          return (
            <Button
              key={f.key}
              asChild
              variant={active ? "default" : "outline"}
              size="sm"
              aria-current={active ? "page" : undefined}
            >
              <Link href={href}>{f.label}</Link>
            </Button>
          );
        })}
      </div>

      <form action="/books" method="get" className="flex flex-wrap gap-2" role="search">
        {type ? <input type="hidden" name="type" value={type} /> : null}
        <Input
          type="search"
          name="search"
          defaultValue={data.search}
          placeholder="Search by description or customer"
          className="max-w-sm"
          aria-label="Search transactions"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
        {data.search || type ? (
          <Button asChild variant="ghost">
            <Link href="/books">Clear</Link>
          </Button>
        ) : null}
      </form>

      {data.transactions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {data.search || type ? "No transactions match your filters." : "No transactions yet."}
          </p>
          {data.canManage && !data.search && !type ? (
            <p className="mt-1 text-sm">
              <Link href="/books/new" className="text-primary hover:underline">
                Record your first transaction
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
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
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${
                        tx.type === "income" ? "text-emerald-600" : "text-foreground"
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
    </div>
  );
}
