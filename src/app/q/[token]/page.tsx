import { notFound } from "next/navigation";
import { CheckCircle2, Clock, FileText, XCircle } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { getQuoteByPublicToken, markQuoteViewed, type PublicQuoteView } from "@/modules/quotes";
import { QuoteAcceptForm } from "./quote-accept-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuoteByPublicToken(token);
  if (!q) return { title: "Quote" };
  return { title: `Quote ${q.number}`, robots: { index: false, follow: false } };
}

const STATUS_BADGE: Record<
  PublicQuoteView["status"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  sent: { label: "Awaiting your response", variant: "default" },
  viewed: { label: "Awaiting your response", variant: "default" },
  accepted: { label: "Accepted", variant: "outline" },
  declined: { label: "Declined", variant: "destructive" },
  expired: { label: "Expired", variant: "destructive" },
  converted: { label: "Converted", variant: "secondary" },
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuoteByPublicToken(token);
  if (!q) notFound();

  // First view of a sent quote flips to "viewed" (idempotent). Render uses the fetched `q`.
  if (q.status === "sent") {
    await markQuoteViewed(token);
  }

  const badge = STATUS_BADGE[q.status];
  const awaiting = q.status === "sent" || q.status === "viewed";

  return (
    <div className="min-h-dvh bg-[#F8FAFC] text-foreground">
      <div className="mx-auto max-w-md px-4 py-6 sm:py-10">
        {/* Top bar: brand wordmark left, status badge right */}
        <header className="mb-6 flex items-center justify-between">
          <span className="font-mono text-sm font-semibold tracking-tight">soletrade labs</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </header>

        <div className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
          {/* Document outline for screen readers — the visible hero uses styled <p>s. */}
          <h1 className="sr-only">Quote {q.number}</h1>

          {/* Hero */}
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Quote</p>
            <p className="font-mono text-sm text-muted-foreground">{q.number}</p>
            <p className="text-sm font-medium">{q.customerName ?? "Walk-in customer"}</p>
          </div>

          {/* Amount block */}
          <div className="mt-5 border-t border-border pt-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Quote total</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums">
              {money(q.totalCents, q.currency)}
            </p>
          </div>

          {/* Line items */}
          <div className="mt-5 space-y-2 border-t border-border pt-5">
            {q.lineItems.map((it, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{it.description}</span>
                  <span className="tabular-nums">{money(it.amountCents, q.currency)}</span>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {it.quantity} × {money(it.unitPriceCents, q.currency)}
                </p>
              </div>
            ))}
          </div>

          {/* Sections (Wave 2) — content blocks in position order, between line items and totals. */}
          {q.sections.length > 0 ? (
            <div className="mt-5 space-y-4 border-t border-border pt-5">
              {q.sections.map((s, i) => (
                <div key={i} className="space-y-1">
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

          {/* Totals */}
          <dl className="mt-5 space-y-1.5 border-t border-border pt-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {q.pricesIncludeTax ? "Subtotal (ex-tax)" : "Subtotal"}
              </dt>
              <dd className="tabular-nums">{money(q.subtotalCents, q.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Tax ({q.taxRate}%{q.pricesIncludeTax ? ", included" : ""})
              </dt>
              <dd className="tabular-nums">{money(q.taxCents, q.currency)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(q.totalCents, q.currency)}</dd>
            </div>
          </dl>

          {/* Terms & Conditions (Wave 2) — collapsible disclosure above the accept button. */}
          {q.termsConditions ? (
            <details id="terms" className="mt-5 rounded-md border border-border bg-muted/30 p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Terms &amp; Conditions
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {q.termsConditions}
              </p>
            </details>
          ) : null}

          {/* Accept/Decline block — only while the customer can still act. */}
          {awaiting ? <QuoteAcceptForm token={token} termsConditions={q.termsConditions} /> : null}

          {q.status === "accepted" ? (
            <div
              className="mt-6 flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-500" aria-hidden />
              <div className="text-sm">
                <p className="font-medium text-emerald-800">Quote accepted</p>
                <p className="text-emerald-700">
                  Thank you — the business will be in touch with an invoice.
                </p>
              </div>
            </div>
          ) : null}

          {q.status === "declined" ? (
            <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <XCircle className="size-5" aria-hidden />
              <span>This quote has been declined.</span>
            </div>
          ) : null}

          {q.status === "expired" ? (
            <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Clock className="size-5" aria-hidden />
              <span>This quote has expired.</span>
            </div>
          ) : null}

          {q.status === "converted" ? (
            <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              <FileText className="size-5" aria-hidden />
              <span>This quote has been converted to an invoice.</span>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="mt-5 space-y-1 text-xs text-muted-foreground">
          <p>
            Issued {formatDate(q.issueDate)}
            {q.validUntil ? ` · Valid until ${formatDate(q.validUntil)}` : ""}
          </p>
          <p>This is a secure link. Do not share it with anyone else.</p>
        </footer>
      </div>
    </div>
  );
}
