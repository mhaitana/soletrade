import { notFound } from "next/navigation";
import { runAfterResponse } from "@/server/infrastructure/after-response";
import { CheckCircle2, Clock, FileText, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getQuoteByPublicToken, markQuoteViewed } from "@/server/domains/quotes/index";
import { brand } from "@/config/brand";
import { formatCents } from "@/lib/domain/billing/pricing";
import { formatDate } from "@/utils/format-date";
import { Logo } from "@/components/logo";
import { QuoteAcceptForm } from "@/features/quotes/components/public/quote-accept-form";
import { QUOTE_PUBLIC_STATUS_DISPLAY } from "@/lib/domain/quotes/status-display";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuoteByPublicToken(token);
  if (!q) return { title: "Quote" };
  return { title: `Quote ${q.number}`, robots: { index: false, follow: false } };
}

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuoteByPublicToken(token);
  if (!q) notFound();

  // First view of a sent quote flips to "viewed" (idempotent). The page renders "sent" and
  // "viewed" identically, so this runs after the response is sent instead of delaying the
  // customer's first paint with the status update, notifications and audit write.
  if (q.status === "sent") {
    await runAfterResponse("[quotes] recording the public view", () => markQuoteViewed(token));
  }

  const badge = QUOTE_PUBLIC_STATUS_DISPLAY[q.status];
  const awaiting = q.status === "sent" || q.status === "viewed";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-10">
        {/* Top bar: issuing business dominant (left), status badge right. Soletrade stays subtle
            (the HB mark only) so it doesn't compete with the merchant's brand. */}
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo variant="mark" href={null} className="shrink-0" />
            {q.merchantName ? (
              <span className="truncate text-base font-semibold tracking-tight text-foreground">
                {q.merchantName}
              </span>
            ) : null}
          </div>
          <Badge variant={badge.variant} className="shrink-0">
            {badge.label}
          </Badge>
        </header>

        <div className="rounded-3xl border border-border/80 bg-card p-6 sm:p-8 shadow-xs">
          {/* Document outline for screen readers - the visible hero uses styled <p>s. */}
          <h1 className="sr-only">Quote {q.number}</h1>

          {/* Hero */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quote
            </p>
            <p className="font-mono text-sm text-muted-foreground">{q.number}</p>
            <p className="text-sm font-semibold text-foreground">
              {q.customerName ?? "Walk-in customer"}
            </p>
          </div>

          {/* Amount block */}
          <div className="mt-6 border-t border-border/60 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Quote total
            </p>
            <p className="mt-1 font-mono text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums text-foreground">
              {formatCents(q.totalCents, q.currency)}
            </p>
          </div>

          {/* Line items */}
          <div className="mt-6 space-y-3 border-t border-border/60 pt-6">
            {q.lineItems.map((it, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {it.description}
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {formatCents(it.amountCents, q.currency)}
                  </span>
                </div>
                <p className="text-xs font-mono text-muted-foreground tabular-nums">
                  {it.quantity} × {formatCents(it.unitPriceCents, q.currency)}
                </p>
              </div>
            ))}
          </div>

          {/* Sections (Wave 2) - content blocks in position order, between line items and totals. */}
          {q.sections.length > 0 ? (
            <div className="mt-6 space-y-4 border-t border-border/60 pt-6">
              {q.sections.map((s, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
                    {s.optional ? (
                      <span className="text-xs text-muted-foreground">(optional)</span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Totals */}
          <dl className="mt-6 space-y-2 border-t border-border/60 pt-6 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {q.pricesIncludeTax ? "Subtotal (ex-tax)" : "Subtotal"}
              </dt>
              <dd className="font-mono tabular-nums text-foreground">
                {formatCents(q.subtotalCents, q.currency)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Tax ({q.taxRate}%{q.pricesIncludeTax ? ", included" : ""})
              </dt>
              <dd className="font-mono tabular-nums text-foreground">
                {formatCents(q.taxCents, q.currency)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border/60 pt-3 text-base font-semibold">
              <dt className="text-foreground">Total</dt>
              <dd className="font-mono tabular-nums text-foreground">
                {formatCents(q.totalCents, q.currency)}
              </dd>
            </div>
          </dl>

          {/* Terms & Conditions (Wave 2) - collapsible disclosure above the accept button. */}
          {q.termsConditions ? (
            <details
              id="terms"
              className="mt-6 rounded-2xl border border-border/80 bg-muted/20 p-4"
            >
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                Terms &amp; Conditions
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {q.termsConditions}
              </p>
            </details>
          ) : null}

          {/* Accept/Decline block - only while the customer can still act. */}
          {awaiting ? <QuoteAcceptForm token={token} termsConditions={q.termsConditions} /> : null}

          {q.status === "accepted" ? (
            <div
              className="mt-6 flex items-center gap-3 rounded-2xl border border-success/20 bg-success/10 p-4 text-success"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
              <div className="text-sm">
                <p className="font-semibold text-success">Quote accepted</p>
                <p className="text-success/90">
                  Thank you - the business will be in touch with an invoice.
                </p>
              </div>
            </div>
          ) : null}

          {q.status === "declined" ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
              <XCircle className="size-5 shrink-0" aria-hidden />
              <span>This quote has been declined.</span>
            </div>
          ) : null}

          {q.status === "expired" ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
              <Clock className="size-5 shrink-0" aria-hidden />
              <span>This quote has expired.</span>
            </div>
          ) : null}

          {q.status === "converted" ? (
            <div className="mt-6 flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
              <FileText className="size-5 shrink-0" aria-hidden />
              <span>This quote has been converted to an invoice.</span>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="mt-6 space-y-1 text-xs text-muted-foreground text-center sm:text-left">
          <p>
            Issued {formatDate(q.issueDate)}
            {q.validUntil ? ` · Valid until ${formatDate(q.validUntil)}` : ""}
          </p>
          <p>This is a secure link. Do not share it with anyone else.</p>
          <p className="pt-2 text-muted-foreground/80">Powered by {brand.productName}</p>
        </footer>
      </div>
    </div>
  );
}
