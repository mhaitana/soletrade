"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { createUpgradeCheckoutAction } from "./actions";

/**
 * Upgrade-to-Pro CTA. Calls the server action to create a Stripe Checkout
 * Session, then redirects the browser to the hosted Checkout URL
 * (`window.location.href` — the URL is external, so `router.push` would not
 * work). No client Stripe SDK is loaded.
 */
export function BillingUpgradeButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await createUpgradeCheckoutAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // External redirect to Stripe Checkout.
      window.location.href = res.url;
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={onClick} disabled={isPending}>
        {isPending ? "Redirecting…" : "Upgrade to Pro"}
      </Button>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
