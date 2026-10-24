import Link from "next/link";
import { Button } from "@/shared/ui/button";
import { ArrowRight, FileText, BookOpen, Car, Receipt } from "lucide-react";
import { brand } from "@/config/brand";
import { InstalledAppRedirect } from "./installed-app-redirect";

const modules = [
  { name: "Invoices", desc: "Fast business billing for freelancers.", icon: Receipt },
  { name: "Books", desc: "Lightweight cash-book ledger for sole traders.", icon: BookOpen },
  { name: "Drive", desc: "Gig delivery earnings and mileage dashboard.", icon: Car },
  { name: "Quotes", desc: "Fast proposal and contract builder.", icon: FileText },
];

export default function MarketingPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-20 md:px-8 md:py-32">
      <InstalledAppRedirect />
      <section className="flex flex-col items-center text-center">
        <p className="text-sm font-medium text-brand-blue">{brand.productName}</p>
        <h1 className="mt-4 max-w-2xl text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {brand.tagline}
        </h1>
        <p className="mt-5 max-w-xl text-balance text-muted-foreground">
          Create invoices, send quotes, track expenses, manage receipts, log mileage, and understand
          your earnings from one simple workspace.
        </p>
        <p className="mt-3 max-w-xl text-balance text-sm text-muted-foreground">
          {brand.shortDescription}
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
