import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getInvoiceByPublicToken, markInvoiceViewed } from "@/server/domains/invoices/index";
import type { PublicInvoiceView } from "@/lib/domain/invoices/types";
import { env } from "@/server/infrastructure/config/env";
import { brand } from "@/config/brand";
import { Logo } from "@/components/logo";
import {
  getPaymentMethodDetails,
  getPaymentMethodLabel,
  type PaymentMethods,
} from "@/types/payment-methods";
import { InvoicePaymentForm } from "@/features/invoices/components/public/invoice-payment-form";

function PaymentMethodsBlock({ methods }: { methods: PaymentMethods }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-muted/20 p-4">
      <h3 className="mb-2 text-sm font-semibold text-foreground">
        Pay by bank transfer, PayPal, or PayID
      </h3>
      <div className="space-y-3">
        {methods.map((method, index) => (
          <div key={index} className="space-y-1">
            <p className="text-sm font-medium">{getPaymentMethodLabel(method)}</p>
            {getPaymentMethodDetails(method).map((detail) => (
              <div key={detail.label} className="flex justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{detail.label}</span>
                <span className="font-mono tabular-nums">{detail.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvoiceByPublicToken(token);
  if (!inv) return { title: "Invoice" };
  return { title: `Invoice ${inv.number}`, robots: { index: false, follow: false } };
}

const STATUS_BADGE: Record<
  PublicInvoiceView["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Awaiting payment", variant: "default" },
  viewed: { label: "Awaiting payment", variant: "default" },
  overdue: { label: "Overdue", variant: "destructive" },
  paid: { label: "Paid", variant: "success" },
  void: { label: "Voided", variant: "destructive" },
};

function formatDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const inv = await getInvoiceByPublicToken(token);
  if (!inv) notFound();

  // First view of a sent invoice flips to "viewed" (idempotent). Render uses the fetched
  // `inv` (already reflects the latest status from the lookup).
  if (inv.status === "sent") {
    await markInvoiceViewed(token);
  }

  const badge = STATUS_BADGE[inv.status];
  const payable = inv.status === "sent" || inv.status === "viewed" || inv.status === "overdue";
  // Publishable key read server-side so the client component never imports env.
  const publishableKey = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-10">
        {/* Top bar: issuing business dominant (left), status badge right. Soletrade stays subtle
            (the HB mark only) so it doesn't compete with the merchant's brand. */}
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo variant="mark" href={null} className="shrink-0" />
            {inv.merchantName ? (
              <span className="truncate text-base font-semibold tracking-tight text-foreground">
                {inv.merchantName}
              </span>
            ) : null}
          </div>
          <Badge variant={badge.variant} className="shrink-0">
            {badge.label}
          </Badge>
        </header>

        <div className="rounded-3xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
          <h1 className="sr-only">Invoice {inv.number}</h1>
          {/* Hero */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Invoice
            </p>
            <p className="font-mono text-sm text-muted-foreground">{inv.number}</p>
            <p className="text-sm font-semibold text-foreground">
              {inv.customerName ?? "Walk-in customer"}
            </p>
          </div>

          {/* Amount block */}
          <div className="mt-6 border-t border-border/60 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Amount due
            </p>
            <p className="mt-1 font-mono text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums text-foreground">
              {money(inv.totalCents, inv.currency)}
            </p>
          </div>

          {/* Line items */}
          <div className="mt-6 space-y-3 border-t border-border/60 pt-6">
            {inv.lineItems.map((it, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {it.description}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {money(it.amountCents, inv.currency)}
                  </span>
                </div>
                <p className="text-xs font-mono text-muted-foreground tabular-nums">
                  {it.quantity} × {money(it.unitPriceCents, inv.currency)}
                </p>
              </div>
            ))}
          </div>

          {/* Totals */}
          <dl className="mt-6 space-y-2 border-t border-border/60 pt-6 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {inv.pricesIncludeTax ? "Subtotal (ex-tax)" : "Subtotal"}
              </dt>
              <dd className="font-mono tabular-nums text-foreground">
                {money(inv.subtotalCents, inv.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Tax ({inv.taxRate}%{inv.pricesIncludeTax ? ", included" : ""})
              </dt>
              <dd className="font-mono tabular-nums text-foreground">
                {money(inv.taxCents, inv.currency)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border/60 pt-3 text-base font-semibold">
              <dt className="text-foreground">Total</dt>
              <dd className="font-mono tabular-nums text-foreground">
                {money(inv.totalCents, inv.currency)}
              </dd>
            </div>
          </dl>

          {/* Status-specific block */}
          {payable ? (
            <div className="mt-6 space-y-4">
              {publishableKey ? (
                <InvoicePaymentForm token={token} invoice={inv} publishableKey={publishableKey} />
              ) : null}
              {inv.paymentMethods.length > 0 ? (
                <PaymentMethodsBlock methods={inv.paymentMethods} />
              ) : publishableKey ? null : (
                <div className="rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
                  Online payment is not configured. Please contact the business to arrange payment.
                </div>
              )}
            </div>
          ) : null}

          {inv.status === "paid" ? (
            <div
              className="mt-6 flex items-center gap-3 rounded-2xl border border-success/20 bg-success/10 p-4 text-success"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-success">Paid</p>
                <p className="text-success/90 font-mono text-xs">
                  {money(inv.totalCents, inv.currency)}
                  {inv.stripeChargeId ? ` · Receipt ${inv.stripeChargeId}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          {inv.status === "void" ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
              <XCircle className="size-5 shrink-0" aria-hidden />
              <span>This invoice has been voided and is no longer payable.</span>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="mt-6 space-y-1 text-xs text-muted-foreground text-center sm:text-left">
          <p>
            Issued {formatDate(inv.issueDate)}
            {inv.dueDate ? ` · Due ${formatDate(inv.dueDate)}` : ""}
          </p>
          <p>This is a secure payment link. Do not share it with anyone else.</p>
          <p className="pt-2 text-muted-foreground/80">Powered by {brand.productName}</p>
        </footer>
      </div>
    </div>
  );
}
