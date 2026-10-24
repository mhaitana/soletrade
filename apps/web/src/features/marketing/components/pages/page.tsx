import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  FileText,
  BookOpen,
  Car,
  Receipt,
  Sparkles,
  CheckCircle2,
  TrendingUp,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { brand } from "@/config/brand";
import { InstalledAppRedirect } from "@/features/marketing/components/installed-app-redirect";

const bentoModules = [
  {
    name: "Invoices",
    tag: "Billing & Collections",
    price: "$6/mo",
    desc: "Fast business billing with instant Stripe Checkout, custom merchant PDFs, and automatic reconciliation.",
    icon: Receipt,
    feature: "Payment link /i/[token] · Apple Pay & Google Pay ready",
  },
  {
    name: "Books",
    tag: "Cash-Book Ledger",
    price: "$9/mo (Anchor)",
    desc: "Lightweight cash-book ledger for sole traders. Instant bank CSV import, tax categorization, and GST reporting.",
    icon: BookOpen,
    feature: "BAS-ready reporting · Receipt OCR hydration",
  },
  {
    name: "Drive",
    tag: "Gig Telemetry",
    price: "$7/mo",
    desc: "Gig delivery earnings and mileage dashboard. Live GPS shifts, shift summaries, and automated tax deductions.",
    icon: Car,
    feature: "Multi-app telemetry · Offline sync queue",
  },
  {
    name: "Quotes",
    tag: "Proposals & Contracts",
    price: "$8/mo",
    desc: "Fast proposal and contract builder with customer e-signature and 1-click invoice conversion.",
    icon: FileText,
    feature: "Public /q/[token] · 1-click convert to Invoice",
  },
];

export default function MarketingPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-16 md:px-8 md:py-24">
      <InstalledAppRedirect />

      {/* Hero Section */}
      <section className="flex flex-col items-center text-center">
        {/* Category Pill */}
        <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-muted/60 px-3.5 py-1 text-xs font-medium text-muted-foreground shadow-xs">
          <span className="size-1.5 rounded-full bg-brand-blue" />
          <span>{brand.productName} · Web &amp; Native iOS/Android</span>
        </div>

        <p className="mt-4 text-sm font-semibold tracking-wide uppercase text-brand-blue">
          {brand.productName}
        </p>

        <h1 className="mt-3 max-w-3xl text-balance text-4xl font-semibold tracking-tight md:text-6xl text-foreground">
          {brand.tagline}
        </h1>

        <p className="mt-5 max-w-2xl text-balance text-base sm:text-lg text-muted-foreground">
          Create invoices, send quotes, track expenses, manage receipts, log mileage, and understand
          your earnings from one simple workspace.
        </p>

        <p className="mt-2 max-w-xl text-balance text-sm text-muted-foreground/80">
          {brand.shortDescription}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="rounded-xl px-7">
            <Link href="/signup">
              Get started <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-xl px-7">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      {/* Workspace Preview Frame */}
      <section className="mt-14 sm:mt-16">
        <div className="rounded-3xl border border-border/80 bg-card p-5 sm:p-7 shadow-md">
          {/* Telemetry Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-5 border-b border-border/60">
            <div className="flex items-center gap-3">
              <div className="size-3 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-semibold text-foreground">
                Workspace Telemetry · Live
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Meridian Design Studio (Sole Trader)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-brand-blue/10 text-brand-blue border-brand-blue/20 text-[11px]"
              >
                <Sparkles className="size-3 mr-1" />
                hAI Active
              </Badge>
              <Badge
                variant="outline"
                className="bg-success/10 text-success border-success/20 text-[11px]"
              >
                Shift Recorded
              </Badge>
            </div>
          </div>

          {/* KPI Preview Bento */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Month-to-Date Net</span>
                <TrendingUp className="size-3.5 text-success" />
              </div>
              <div className="mt-2 font-mono text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                $14,850.00
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-success">
                <span>+18.4% vs last month</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Invoices Collected</span>
                <CheckCircle2 className="size-3.5 text-brand-blue" />
              </div>
              <div className="mt-2 font-mono text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                $11,200.00
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <span>98.2% on-time settlement</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Active Shift Telemetry</span>
                <Clock className="size-3.5 text-warning" />
              </div>
              <div className="mt-2 font-mono text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums text-foreground">
                74.2 km
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                <span>$63.07 tax deduction accrued</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Module Showcase (2×2 Grid) */}
      <section className="mt-16 sm:mt-20">
        <div className="text-center max-w-xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
            Four specialized tools. Zero fragmentation.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Activate only what your business requires. The intelligent anchor architecture
            automatically applies stacking discounts.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {bentoModules.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.name}
                className="group relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-7 shadow-xs transition-all hover:shadow-md hover:border-foreground/20"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
                      <Icon className="size-5" aria-hidden />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                        {m.price}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{m.name}</h3>
                    <span className="text-xs text-muted-foreground">· {m.tag}</span>
                  </div>

                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{m.desc}</p>
                </div>

                <div className="mt-5 pt-4 border-t border-border/50 flex items-center justify-between text-xs font-mono text-muted-foreground">
                  <span className="line-clamp-1">{m.feature}</span>
                  <ArrowRight className="size-3.5 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-foreground" />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Security & Reliability Callout */}
      <section className="mt-16 rounded-2xl border border-border/60 bg-muted/20 p-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-xl bg-background border border-border flex items-center justify-center shrink-0">
            <ShieldCheck className="size-5 text-success" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">
              Bank-Grade Isolation &amp; Audit Integrity
            </div>
            <div className="text-xs text-muted-foreground">
              Zero customer tracking. Deterministic schema validation. Local-first offline recovery.
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/pricing">View full pricing</Link>
        </Button>
      </section>
    </div>
  );
}
