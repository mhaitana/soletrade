"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { MODULES, MODULE_KEYS, type ModuleKey } from "@/shared/constants/modules";
import { MODULE_PRICES, formatCents, type Interval } from "@/platform/billing/pricing";
import { startBillingCheckoutAction } from "./actions";

/**
 * Start-billing card. Lets an owner/admin pick a set of modules + an interval and
 * continue to Stripe Checkout. The highest-standalone-price module becomes the anchor
 * (charged standalone); the rest are add-ons (standalone − $2.50/mo / $22.50/yr).
 *
 * Calls the server action to create a Checkout Session, then redirects the browser
 * to the hosted Checkout URL (`window.location.href` - the URL is external, so
 * `router.push` would not work). No client Stripe SDK is loaded.
 */
export function BillingStartCard() {
  const [selected, setSelected] = useState<Set<ModuleKey>>(new Set<ModuleKey>(["books"]));
  const [interval, setInterval] = useState<Interval>("monthly");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const selectedKeys = MODULE_KEYS.filter((k) => selected.has(k));
  const noneSelected = selectedKeys.length === 0;
  const suffix = interval === "monthly" ? "/mo" : "/yr";

  function toggle(key: ModuleKey) {
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await startBillingCheckoutAction({
        moduleKeys: selectedKeys,
        interval,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // External redirect to Stripe Checkout.
      window.location.href = res.url;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Start billing</CardTitle>
        <CardDescription>
          Pick the modules you want. The highest-priced one is your anchor app (full price); the
          rest get a $2.50/mo stack discount. Annual billing = 9 paid months (3 months free).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Module checkboxes with standalone prices */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Modules</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODULE_KEYS.map((key) => {
              const checked = selected.has(key);
              const price = MODULE_PRICES[key].standalone[interval];
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-center justify-between rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(key)}
                      className="size-4 accent-primary"
                    />
                    <span>{MODULES[key].name}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCents(price)}
                    {suffix}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Interval toggle */}
        <fieldset>
          <legend className="text-sm font-medium">Billing interval</legend>
          <div className="mt-2 inline-flex rounded-md border p-0.5 text-sm">
            {(["monthly", "annual"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setInterval(iv)}
                aria-pressed={interval === iv}
                className={`rounded px-3 py-1 capitalize ${
                  interval === iv ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {iv}
                {iv === "annual" ? <span className="ml-1 text-xs">(3 months free)</span> : null}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col items-end gap-1">
          <Button onClick={onClick} disabled={isPending || noneSelected}>
            {isPending ? "Redirecting…" : "Continue to payment"}
          </Button>
          {noneSelected ? (
            <p className="text-xs text-muted-foreground">Select at least one module.</p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
