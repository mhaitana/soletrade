import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { loadInvoicesPage } from "./actions";
import type { InvoiceStatus } from "@/server/db/schema/enums";

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
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  viewed: { label: "Sent", variant: "default" },
  paid: { label: "Paid", variant: "outline" },
  void: { label: "Void", variant: "destructive" },
  overdue: { label: "Overdue", variant: "destructive" },
};

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; search?: string | string[] }>;
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
  const data = await loadInvoicesPage({ status, search: rawSearch });

  if (!data.installed) return <ModuleNotInstalledCard moduleKey="invoices" />;

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

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter invoices by status"
      >
        {STATUS_FILTERS.map((f) => {
          const active = (f.key === "all" && !status) || f.key === status;
          const href =
            f.key === "all"
              ? data.search
                ? `/invoices?search=${encodeURIComponent(data.search)}`
                : "/invoices"
              : `/invoices?status=${f.key}${data.search ? `&search=${encodeURIComponent(data.search)}` : ""}`;
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

      <form action="/invoices" method="get" className="flex flex-wrap gap-2" role="search">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <Input
          type="search"
          name="search"
          defaultValue={data.search}
          placeholder="Search by invoice number or customer"
          className="max-w-sm"
          aria-label="Search invoices"
        />
        <Button type="submit" variant="outline">
          <Search className="size-4" aria-hidden />
          Search
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
            {data.search || status ? "No invoices match your filters." : "No invoices yet."}
          </p>
          {data.canManage && !data.search && !status ? (
            <p className="mt-1 text-sm">
              <Link href="/invoices/new" className="text-primary hover:underline">
                Create your first invoice
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
                  Number
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Issued
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Due
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
              {data.invoices.map((inv) => {
                const badge = STATUS_BADGE[inv.status];
                return (
                  <tr key={inv.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {inv.customerName ? (
                        <span className="text-foreground">{inv.customerName}</span>
                      ) : (
                        <span className="text-muted-foreground">Walk-in</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.issueDate)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.dueDate)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatCents(inv.totalCents, inv.currency)}
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
