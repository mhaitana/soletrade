import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { ArrowRight, FileText, BookOpen, Car, Receipt } from "lucide-react";

const modules = [
  { name: "soletrade Invoices", desc: "Fast business billing for freelancers.", icon: Receipt },
  { name: "soletrade Books", desc: "Lightweight cash-book ledger for sole traders.", icon: BookOpen },
  { name: "soletrade Drive", desc: "Gig delivery earnings and mileage dashboard.", icon: Car },
  { name: "soletrade Quotes", desc: "Fast proposal and contract builder.", icon: FileText },
];

export default function MarketingPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:px-8 md:py-32">
      <section className="flex flex-col items-center text-center">
        <p className="text-sm font-medium text-brand-blue">The business operating system</p>
        <h1 className="mt-4 max-w-2xl text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          One workspace for invoices, books, quotes, and gig earnings.
        </h1>
        <p className="mt-5 max-w-xl text-balance text-muted-foreground">
          soletrade OS is a modular, mobile-first platform for solo traders, freelancers, and gig
          operators. Enable the modules you need — share customers, files, and billing across all of
          them.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">
              Get started <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="mt-20 grid gap-3 sm:grid-cols-2">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.name}
              className="rounded-lg border border-border bg-card p-6 transition-colors hover:bg-muted/40"
            >
              <Icon className="size-5 text-foreground" aria-hidden />
              <h2 className="mt-4 text-base font-semibold">{m.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{m.desc}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
