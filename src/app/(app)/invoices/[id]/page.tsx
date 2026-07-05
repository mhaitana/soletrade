import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { loadInvoice } from "../actions";
import { InvoiceDetailActions } from "../invoice-detail-actions";
import type { InvoiceStatus } from "@/server/db/schema/enums";

export const metadata = { title: "Invoice" };

const STATUS_BADGE: Record<
  InvoiceStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  viewed: { label: "Viewed", variant: "default" },
  paid: { label: "Paid", variant: "outline" },
  void: { label: "Void", variant: "destructive" },
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadInvoice(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="invoices" />;
  if (!data.invoice) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Invoice not found.</p>
        <Button asChild variant="outline">
          <Link href="/invoices">Back to invoices</Link>
        </Button>
      </div>
    );
  }

  const inv = data.invoice;
  const badge = STATUS_BADGE[inv.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{inv.number}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {inv.customerName ? (
              <Link href={`/customers`} className="hover:underline">
                {inv.customerName}
              </Link>
            ) : (
              "Walk-in customer"
            )}
          </p>
        </div>
        {data.canManage ? <InvoiceDetailActions invoiceId={inv.id} status={inv.status} /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Issued</dt>
          <dd className="text-sm">{formatDate(inv.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Due</dt>
          <dd className="text-sm">{formatDate(inv.dueDate)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Currency</dt>
          <dd className="text-sm">{inv.currency}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tax rate</dt>
          <dd className="text-sm tabular-nums">{inv.taxRate}%</dd>
        </div>
      </dl>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Description
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Unit price
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {inv.lineItems.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-3">{it.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(it.unitPriceCents, inv.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(it.amountCents, inv.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto w-full max-w-xs space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatCents(inv.subtotalCents, inv.currency)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Tax ({inv.taxRate}%)</span>
          <span className="tabular-nums">{formatCents(inv.taxCents, inv.currency)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2 text-base font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatCents(inv.totalCents, inv.currency)}</span>
        </div>
      </div>

      {inv.notes ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{inv.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
