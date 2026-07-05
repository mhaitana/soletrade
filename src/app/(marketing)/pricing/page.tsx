import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { MODULES } from "@/shared/constants/modules";
import type { ModuleKey } from "@/shared/constants/modules";
import { MODULE_PRICES, priceSubscription, formatCents, type Interval } from "@/platform/billing";

export const metadata = { title: "Pricing" };

/**
 * Display the price table in the spec's order (Books, Quotes, Drive, Invoices) —
 * highest standalone first, which matches the anchor priority in §10.3.
 */
const DISPLAY_ORDER: ModuleKey[] = ["books", "quotes", "drive", "invoices"];

const priceColumns: { interval: Interval; role: "standalone" | "addon"; label: string }[] = [
  { interval: "monthly", role: "standalone", label: "Standalone / mo" },
  { interval: "annual", role: "standalone", label: "Standalone / yr" },
  { interval: "monthly", role: "addon", label: "Add-on / mo" },
  { interval: "annual", role: "addon", label: "Add-on / yr" },
];

export default function PricingPage() {
  const monthlyExample = priceSubscription(DISPLAY_ORDER, "monthly");
  const annualExample = priceSubscription(DISPLAY_ORDER, "annual");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 md:px-8 md:py-24">
      <section className="flex flex-col items-center text-center">
        <p className="text-sm font-medium text-brand-blue">Pricing</p>
        <h1 className="mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
          Pay for what you use. Save when you stack.
        </h1>
        <p className="mt-5 max-w-xl text-balance text-muted-foreground">
          Each product has a standalone price and a discounted add-on price. Your highest-priced
          active product is your <strong>anchor app</strong> — you pay full standalone price for it.
          Every other active product gets a flat $2.50/mo stack discount. Annual billing gives you 3
          months free (9 paid months).
        </p>
      </section>

      {/* 4×4 price table */}
      <section className="mt-12">
        <h2 className="text-lg font-semibold">Per-product prices</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          All prices in AUD, excl. GST. Add-on prices already include the $2.50/mo stack discount.
        </p>
        <Card className="mt-4">
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="p-4 font-medium">
                    Product
                  </th>
                  {priceColumns.map((col) => (
                    <th key={col.label} scope="col" className="p-4 text-right font-medium">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DISPLAY_ORDER.map((key) => {
                  const m = MODULES[key];
                  return (
                    <tr key={key} className="border-b last:border-0">
                      <th scope="row" className="p-4 text-left font-medium">
                        {m.name}
                      </th>
                      {priceColumns.map((col) => (
                        <td
                          key={`${col.interval}-${col.role}`}
                          className="p-4 text-right tabular-nums"
                        >
                          {formatCents(MODULE_PRICES[key][col.role][col.interval])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Anchor rule + examples */}
      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How the anchor app works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The product with the highest standalone price is your anchor app and is billed at its
              full standalone price.
            </p>
            <p>
              Every other active product is billed at its add-on price — a flat $2.50/mo off
              standalone ($22.50/yr off on annual).
            </p>
            <p className="text-foreground">
              Priority: Books ($9) &gt; Quotes ($8) &gt; Drive ($7) &gt; Invoices ($6).
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">All four products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="text-muted-foreground">Monthly workspace</p>
            <p className="tabular-nums font-medium">{formatCents(monthlyExample.totalCents)}/mo</p>
            <p className="mt-3 text-muted-foreground">Annual workspace</p>
            <p className="tabular-nums font-medium">{formatCents(annualExample.totalCents)}/yr</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Books is the anchor ($9/mo standalone); Quotes, Drive, and Invoices are add-ons
              ($5.50, $4.50, $3.50/mo).
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="mt-12 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/signup">
            Get started <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    </div>
  );
}
