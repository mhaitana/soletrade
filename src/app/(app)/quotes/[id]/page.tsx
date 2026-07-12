import Link from "next/link";
import { ArrowRight, Download } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { ModuleNotInstalledCard } from "@/shared/components/module-not-installed-card";
import { formatCents } from "@/platform/billing/pricing";
import { formatDate } from "@/shared/utils/format-date";
import { loadQuote } from "../actions";
import { QuoteDetailActions } from "../quote-detail-actions";
import type { QuoteStatus } from "@/server/db/enums";

export const metadata = { title: "Quote" };

const STATUS_BADGE: Record<
  QuoteStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Sent", variant: "default" },
  viewed: { label: "Viewed", variant: "default" },
  accepted: { label: "Accepted", variant: "outline" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  converted: { label: "Converted", variant: "secondary" },
};

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadQuote(id);
  if (!data.installed) return <ModuleNotInstalledCard moduleKey="quotes" />;
  if (!data.quote) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Quote not found.</p>
        <Button asChild variant="outline">
          <Link href="/quotes">Back to quotes</Link>
        </Button>
      </div>
    );
  }

  const q = data.quote;
  const badge = STATUS_BADGE[q.status];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{q.number}</h1>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {q.customerName ? (
              <Link href={`/customers`} className="hover:underline">
                {q.customerName}
              </Link>
            ) : (
              "Walk-in customer"
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`/quotes/${q.id}/pdf`}>
              <Download className="size-4" aria-hidden />
              PDF
            </Link>
          </Button>
          {data.canManage ? <QuoteDetailActions quoteId={q.id} status={q.status} /> : null}
        </div>
      </div>

      {q.status === "converted" && q.convertedInvoiceId ? (
        <div className="rounded-md border border-border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Converted to invoice</p>
          <p className="mt-1">
            <Link
              href={`/invoices/${q.convertedInvoiceId}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              View the draft invoice
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Issued</dt>
          <dd className="text-sm">{formatDate(q.issueDate)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Valid until</dt>
          <dd className="text-sm">{formatDate(q.validUntil)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Currency</dt>
          <dd className="text-sm">{q.currency}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tax rate</dt>
          <dd className="text-sm tabular-nums">{q.taxRate}%</dd>
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
            {q.lineItems.map((it) => (
              <tr key={it.id}>
                <td className="px-4 py-3">{it.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(it.unitPriceCents, q.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatCents(it.amountCents, q.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {q.sections.length > 0 ? (
        <div className="space-y-4 rounded-lg border border-border p-4">
          {q.sections.map((s) => (
            <div key={s.id} className="space-y-1">
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-medium">{s.title}</h3>
                {s.optional ? (
                  <span className="text-xs text-muted-foreground">(optional)</span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="ml-auto w-full max-w-xs space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatCents(q.subtotalCents, q.currency)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Tax ({q.taxRate}%)</span>
          <span className="tabular-nums">{formatCents(q.taxCents, q.currency)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2 text-base font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatCents(q.totalCents, q.currency)}</span>
        </div>
      </div>

      {q.notes ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{q.notes}</p>
        </div>
      ) : null}

      {q.termsConditions ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Terms &amp; Conditions
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{q.termsConditions}</p>
        </div>
      ) : null}

      {q.status === "accepted" && data.acceptance ? (
        <AcceptanceCard acceptance={data.acceptance} />
      ) : null}
    </div>
  );
}

/** Render the captured acceptance evidence (Wave 2). Signature may be a data-URL or plain text. */
function AcceptanceCard({
  acceptance,
}: {
  acceptance: {
    accepterName: string;
    accepterEmail: string | null;
    ipAddress: string;
    userAgent: string;
    signature: string | null;
    acceptedAt: Date;
  };
}) {
  const isDataUrl = acceptance.signature?.startsWith("data:");
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/50 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Acceptance</p>
      <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Accepted by</dt>
          <dd className="font-medium">{acceptance.accepterName}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{acceptance.accepterEmail || "-"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">IP address</dt>
          <dd className="font-mono text-xs">{acceptance.ipAddress}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">User agent</dt>
          <dd className="truncate font-mono text-xs" title={acceptance.userAgent}>
            {acceptance.userAgent}
          </dd>
        </div>
        <div className="flex justify-between gap-2 sm:col-span-2">
          <dt className="text-muted-foreground">Accepted at</dt>
          <dd>{formatDate(acceptance.acceptedAt)}</dd>
        </div>
      </dl>
      {acceptance.signature ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Signature</p>
          {isDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- canvas data-URL, no Next Image needed
            <img
              src={acceptance.signature}
              alt={`Signature of ${acceptance.accepterName}`}
              className="mt-1 max-h-24 rounded border border-border bg-white"
            />
          ) : (
            <p className="mt-1 font-medium">{acceptance.signature}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
