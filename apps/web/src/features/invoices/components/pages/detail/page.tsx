import Link from "next/link";
import { AskHaiButton } from "@/components/ask-hai-button";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModuleNotInstalledCard } from "@/components/module-not-installed-card";
import { formatCents } from "@/lib/domain/billing/pricing";
import { formatDate } from "@/utils/format-date";
import { loadInvoice } from "@/features/invoices/api/actions";
import { InvoiceDetailActions } from "@/features/invoices/components/invoice-detail-actions";
import { INVOICE_STATUS_DISPLAY } from "@/lib/domain/invoices/status-display";
import { CopyLinkButton } from "@/components/copy-link-button";

export const metadata = { title: "Invoice" };

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
  const badge = INVOICE_STATUS_DISPLAY[inv.status];

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
              <Link
                href={inv.customerId ? `/customers/${inv.customerId}` : "/customers"}
                className="hover:underline"
              >
                {inv.customerName}
              </Link>
            ) : (
              "Walk-in customer"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AskHaiButton question="Summarise this invoice and tell me if anything needs my attention." />
          <Button asChild variant="outline">
            <Link href={`/invoices/${inv.id}/pdf`}>
              <Download className="size-4" aria-hidden />
              PDF
            </Link>
          </Button>
          {data.canManage ? <InvoiceDetailActions invoiceId={inv.id} status={inv.status} /> : null}
        </div>
      </div>

      {inv.publicToken && inv.status !== "draft" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Customer payment link
            </p>
            <p className="mt-1 break-all font-mono text-sm">/i/{inv.publicToken}</p>
          </div>
          <CopyLinkButton path={`/i/${inv.publicToken}`} label="Copy customer link" />
        </div>
      ) : null}

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
        <table className="hidden w-full text-sm sm:table">
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
        <div className="sm:hidden divide-y divide-border" data-testid="invoice-line-items-mobile">
          {inv.lineItems.map((it) => (
            <div key={it.id} className="px-4 py-3 space-y-1">
              <p className="text-sm font-medium">{it.description}</p>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {it.quantity} × {formatCents(it.unitPriceCents, inv.currency)}
                </span>
                <span className="font-medium tabular-nums text-foreground">
                  {formatCents(it.amountCents, inv.currency)}
                </span>
              </div>
            </div>
          ))}
        </div>
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
