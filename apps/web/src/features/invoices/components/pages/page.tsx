import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ResponsiveFilter } from "@/components/ui/responsive-filter";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { ListPagination } from "@/components/list-pagination";
import { pageHref, parsePage } from "@/utils/pagination";
import { formatCents } from "@/lib/domain/billing/pricing";
import { formatDate } from "@/utils/format-date";
import { loadInvoicesPage } from "@/features/invoices/api/actions";
import type { InvoiceStatus } from "@/lib/domain/database-enums";

export const metadata = { title: "Invoices" };

const STATUS_FILTERS: { key: "all" | InvoiceStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
  { key: "void", label: "Void" },
];

const STATUS_BADGE: Record<
  InvoiceStatus,
  { label: string; variant: "secondary" | "outline" | "success" | "destructive" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "outline" },
  viewed: { label: "Sent", variant: "outline" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Void", variant: "destructive" },
  overdue: { label: "Overdue", variant: "destructive" },
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    search?: string | string[];
    page?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const rawStatus = typeof sp.status === "string" ? sp.status : undefined;
  const rawSearch = typeof sp.search === "string" ? sp.search : undefined;
  const status =
    rawStatus === "draft" ||
    rawStatus === "sent" ||
    rawStatus === "paid" ||
    rawStatus === "overdue" ||
    rawStatus === "void"
      ? (rawStatus as InvoiceStatus)
      : undefined;
  const data = await loadInvoicesPage({ status, search: rawSearch, page: parsePage(sp.page) });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="invoices" />;

  const statusFilterItems = STATUS_FILTERS.map((filter) => {
    const active = (filter.key === "all" && !status) || filter.key === status;
    const search = data.search ? `&search=${encodeURIComponent(data.search)}` : "";
    const href =
      filter.key === "all"
        ? data.search
          ? `/invoices?search=${encodeURIComponent(data.search)}`
          : "/invoices"
        : `/invoices?status=${filter.key}${search}`;
    return { key: filter.key, label: filter.label, href, active };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">Bill your customers and track payment.</p>
        </div>
        {data.canManage ? (
          <Button asChild>
            <Link href="/invoices/new">
              <Plus className="size-4" aria-hidden />
              New invoice
            </Link>
          </Button>
        ) : null}
      </div>

      <ResponsiveFilter label="Filter invoices by status" items={statusFilterItems} />

      <form
        action="/invoices"
        method="get"
        className="flex flex-wrap items-center gap-2"
        role="search"
      >
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Input
          type="search"
          name="search"
          defaultValue={data.search}
          placeholder="Search by invoice number or customer"
          className="min-w-0 flex-1 sm:max-w-sm"
          aria-label="Search invoices"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" aria-hidden />
          <span className="max-sm:sr-only">Search</span>
        </Button>
        {data.search || status ? (
          <Button asChild variant="ghost">
            <Link href="/invoices">Clear</Link>
          </Button>
        ) : null}
      </form>

      {data.invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {data.page > 1
              ? "No invoices on this page."
              : data.search || status
                ? "No invoices match your filters."
                : "No invoices yet."}
          </p>
          {data.page > 1 ? (
            <p className="mt-1 text-sm">
              <Link
                href={pageHref("/invoices", 1, { status, search: data.search })}
                className="text-brand-blue hover:underline"
              >
                Return to first page
              </Link>
            </p>
          ) : data.canManage && !data.search && !status ? (
            <p className="mt-1 text-sm">
              <Link href="/invoices/new" className="text-brand-blue hover:underline">
                Create your first invoice
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <DataTable
          rows={data.invoices}
          rowKey={(inv) => inv.id}
          columns={
            [
              {
                header: "Number",
                className: "font-mono text-xs",
                cell: (inv) => (
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {inv.number}
                  </Link>
                ),
              },
              {
                header: "Customer",
                cell: (inv) =>
                  inv.customerName ? (
                    <span className="text-foreground">{inv.customerName}</span>
                  ) : (
                    <span className="text-muted-foreground">Walk-in</span>
                  ),
              },
              {
                header: "Issued",
                className: "text-muted-foreground",
                cell: (inv) => formatDate(inv.issueDate),
              },
              {
                header: "Due",
                className: "text-muted-foreground",
                cell: (inv) => formatDate(inv.dueDate),
              },
              {
                header: "Status",
                cell: (inv) => {
                  const badge = STATUS_BADGE[inv.status];
                  return <Badge variant={badge.variant}>{badge.label}</Badge>;
                },
              },
              {
                header: "Total",
                numeric: true,
                cell: (inv) => formatCents(inv.totalCents, inv.currency),
              },
            ] satisfies Column<(typeof data.invoices)[number]>[]
          }
        />
      )}
      <ListPagination
        pathname="/invoices"
        page={data.page}
        hasNext={data.hasNext}
        filters={{ status, search: data.search }}
      />
    </div>
  );
}
