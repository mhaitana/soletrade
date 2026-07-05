import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { loadQuotesPage } from "./actions";
import type { QuoteStatus } from "@/server/db/schema/enums";

export const metadata = { title: "Quotes" };

const STATUS_FILTERS: { key: "all" | QuoteStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
  { key: "converted", label: "Converted" },
];

const STATUS_BADGE: Record<
  QuoteStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  viewed: { label: "Sent", variant: "default" },
  accepted: { label: "Accepted", variant: "outline" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  converted: { label: "Converted", variant: "secondary" },
};

const VALID_STATUSES: QuoteStatus[] = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "converted",
];

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; search?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawStatus = typeof sp.status === "string" ? sp.status : undefined;
  const rawSearch = typeof sp.search === "string" ? sp.search : undefined;
  const status =
    rawStatus && VALID_STATUSES.includes(rawStatus as QuoteStatus)
      ? (rawStatus as QuoteStatus)
      : undefined;
  const data = await loadQuotesPage({ status, search: rawSearch });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="quotes" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground">
            Send proposals and convert accepted quotes to invoices.
          </p>
        </div>
        {data.canManage ? (
          <Button asChild>
            <Link href="/quotes/new">
              <Plus className="size-4" aria-hidden />
              New quote
            </Link>
          </Button>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter quotes by status"
      >
        {STATUS_FILTERS.map((f) => {
          const active = (f.key === "all" && !status) || f.key === status;
          const href =
            f.key === "all"
              ? data.search
                ? `/quotes?search=${encodeURIComponent(data.search)}`
                : "/quotes"
              : `/quotes?status=${f.key}${data.search ? `&search=${encodeURIComponent(data.search)}` : ""}`;
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

      <form action="/quotes" method="get" className="flex flex-wrap gap-2" role="search">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Input
          type="search"
          name="search"
          defaultValue={data.search}
          placeholder="Search by quote number or customer"
          className="max-w-sm"
          aria-label="Search quotes"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
        {data.search || status ? (
          <Button asChild variant="ghost">
            <Link href="/quotes">Clear</Link>
          </Button>
        ) : null}
      </form>

      {data.quotes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {data.search || status ? "No quotes match your filters." : "No quotes yet."}
          </p>
          {data.canManage && !data.search && !status ? (
            <p className="mt-1 text-sm">
              <Link href="/quotes/new" className="text-primary hover:underline">
                Create your first quote
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
                  Number
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Issued
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Valid until
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.quotes.map((q) => {
                const badge = STATUS_BADGE[q.status];
                return (
                  <tr key={q.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/quotes/${q.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {q.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {q.customerName ? (
                        <span className="text-foreground">{q.customerName}</span>
                      ) : (
                        <span className="text-muted-foreground">Walk-in</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(q.issueDate)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(q.validUntil)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCents(q.totalCents, q.currency)}
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
