"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { createInvoicePaymentIntentAction } from "@/features/invoices/api/public/actions";
import type { PublicInvoiceView } from "@/lib/domain/invoices/types";
import { formatCents } from "@/lib/domain/billing/pricing";

type Stage = "loading" | "paying" | "succeeded" | "failed";

function PayButtonForm({ invoice }: { invoice: PublicInvoiceView }) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("paying");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  // Elements readiness is derived from the Stripe hooks (not state) - the Pay button stays
  // disabled until `stripe` + `elements` are non-null.
  const ready = Boolean(stripe && elements);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setError("");
    setBusy(true);
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Payment failed. Please try again.");
      setStage("failed");
      return;
    }
    setStage("succeeded");
    // Re-read the page so the header badge and amount label follow the payment. The paid
    // status arrives by webhook, so this may still show "Awaiting payment" for a moment;
    // the confirmation below does not depend on it.
    router.refresh();
  }

  if (stage === "succeeded") {
    return (
      <div
        className="flex items-center gap-3 rounded-2xl border border-success/20 bg-success/10 p-4 text-success"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 className="size-5 shrink-0" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">Payment successful</p>
          <p className="text-foreground">
            Paid {formatCents(invoice.totalCents, invoice.currency)}. A confirmation will appear
            shortly.
          </p>
        </div>
      </div>
    );
  }

  const submitting = busy || !ready;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement options={{ layout: { type: "accordion" } }} />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        disabled={submitting}
        className="w-full"
        aria-label={`Pay ${formatCents(invoice.totalCents, invoice.currency)}`}
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Processing…
          </>
        ) : (
          `Pay ${formatCents(invoice.totalCents, invoice.currency)}`
        )}
      </Button>
    </form>
  );
}

export function InvoicePaymentForm({
  token,
  invoice,
  publishableKey,
}: {
  token: string;
  invoice: PublicInvoiceView;
  publishableKey: string;
}) {
  const [clientSecret, setClientSecret] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");
  // loadStripe is idempotent + returns a stable promise; memoize on the key so it doesn't
  // re-run on every render (avoids the set-state-in-effect lint + unnecessary work).
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);

  useEffect(() => {
    let cancelled = false;
    createInvoicePaymentIntentAction({ token }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setClientSecret(res.clientSecret);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loadError) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        {loadError}
      </div>
    );
  }

  if (!clientSecret || !stripePromise) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Preparing secure payment…
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <PayButtonForm invoice={invoice} />
    </Elements>
  );
}
