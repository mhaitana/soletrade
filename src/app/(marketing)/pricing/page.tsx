import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { MODULES, MODULE_KEYS } from "@/shared/constants/modules";
import { PRICING_CATALOG, formatCents, priceSubscription } from "@/platform/billing";

export const metadata = { title: "Pricing" };

const stackDiscountLabels = ["1st module", "2nd module", "3rd module", "4th+ module"];

export default function PricingPage() {
  const pro = PRICING_CATALOG.tiers.pro;
  const fourModuleExample = priceSubscription("pro", [...MODULE_KEYS]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 md:px-8 md:py-24">
      <section className="flex flex-col items-center text-center">
        <p className="text-sm font-medium text-brand-blue">Pricing</p>
        <h1 className="mt-3 max-w-2xl text-balance text-4xl font-bold tracking-tight md:text-5xl">
          One Pro anchor. Add the modules you need.
        </h1>
        <p className="mt-5 max-w-xl text-balance text-muted-foreground">
          Every workspace starts free. Upgrade to Pro for the anchor app, then add modules à la
          carte — the more you stack, the more you save.
        </p>
      </section>

      {/* Tier cards */}
      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">Free</CardTitle>
            <p className="text-sm text-muted-foreground">
              For trying the workspace and inviting your team.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-4xl font-semibold tabular-nums">
              {formatCents(PRICING_CATALOG.tiers.free.anchorCents)}
              <span className="text-base font-normal text-muted-foreground">/mo</span>
            </p>
            <ul className="space-y-2 text-sm">
              <Feature>Workspace + team members</Feature>
              <Feature>Customers, activity feed, files</Feature>
              <Feature muted>No paid modules</Feature>
            </ul>
            <Button asChild variant="outline" className="w-full">
              <Link href="/signup">Get started</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/40 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-2xl">
              Pro
              <Badge>Recommended</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              The anchor app + every module you enable.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-4xl font-semibold tabular-nums">
              {formatCents(pro.anchorCents)}
              <span className="text-base font-normal text-muted-foreground">/mo anchor</span>
            </p>
            <ul className="space-y-2 text-sm">
              <Feature>Everything in Free</Feature>
              <Feature>Add modules at {formatCents(pro.modulePriceCents)}/mo each</Feature>
              <Feature>Stack discounts on add-ons</Feature>
            </ul>
            <Button asChild className="w-full">
              <Link href="/signup">
                Start with Pro <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* Per-module prices */}
      <section className="mt-16">
        <h2 className="text-lg font-semibold">Add-on modules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatCents(pro.modulePriceCents)}/mo each on Pro. Enable only what you need.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULE_KEYS.map((key) => {
            const m = MODULES[key];
            const Icon = m.icon;
            return (
              <Card key={key} className="transition-colors hover:border-primary/40">
                <CardHeader>
                  <Icon className="size-5 text-primary" aria-hidden />
                  <CardTitle className="mt-3 text-sm">{m.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">{m.description}</p>
                  <p className="mt-4 text-sm font-medium tabular-nums">
                    {formatCents(pro.modulePriceCents)}/mo
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Stack discount explainer */}
      <section className="mt-16">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stack discount</CardTitle>
            <p className="text-sm text-muted-foreground">
              The more modules you add, the deeper the discount on each additional one.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {PRICING_CATALOG.stackDiscountRates.map((rate, i) => (
                <div key={i} className="rounded-lg border border-border p-3 text-center">
                  <p className="text-xs text-muted-foreground">{stackDiscountLabels[i]}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {Math.round(rate * 100)}% off
                  </p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Example: Pro with all four modules comes to{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatCents(fourModuleExample.totalCents)}/mo
              </span>{" "}
              (anchor {formatCents(fourModuleExample.anchorCents)} + modules, with{" "}
              {formatCents(fourModuleExample.totalDiscountCents)} in stack discounts).
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

function Feature({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <Check
        className={`size-4 ${muted ? "text-muted-foreground/50" : "text-[#059669]"}`}
        aria-hidden
      />
      <span className={muted ? "text-muted-foreground" : "text-foreground"}>{children}</span>
    </li>
  );
}
