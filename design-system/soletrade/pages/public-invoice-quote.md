# Page Override - Public Invoice & Quote Pages (mobile-first)

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for the **public, customer-facing** invoice payment page and quote acceptance page. These are the highest-stakes polish surfaces - viewed on phones, by people who are not logged in.

## Core Principles
- Mobile-first, single column, `max-w-md mx-auto` on desktop.
- No app shell, no sidebar, no bottom nav. Minimal header with brand monogram/wordmark and merchant identity.
- Warm alabaster background (`bg-background`), floating card container with continuous squircle curves (`rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-xs sm:shadow-md`).
- Fast loading Server Component, minimal client JS.
- **Token-driven only** - zero hardcoded `bg-[#F8FAFC]` or `bg-white`. Use `bg-background`, `bg-card`, `border-border`.

## Layout & Typography
- Monogram & Merchant header: merchant name takes prominence, status badge right-aligned.
- Document metadata: document type ("INVOICE" / "QUOTE"), number in `font-mono text-sm text-muted-foreground`.
- Amount Hero: `font-mono text-4xl sm:text-5xl font-semibold tracking-tight tabular-nums text-foreground`.
- Line items: clean stacked cards or rows with `divide-y divide-border/60`.
- Totals: subtotal, tax/GST, grand total - right aligned, `font-mono tabular-nums`.
- Invoices: Apple Pay / Google Pay / Stripe card button - primary obsidian or Stripe-branded CTA (`h-12 rounded-xl text-base font-semibold`).
- Quotes: "Accept" (primary obsidian pill) + "Decline" (outline), with explicit confirmation modal.
- Paid/Accepted Confirmation: tactile confirmation banner with `bg-success/10 border border-success/20 text-success rounded-2xl p-4`.

## Security & Accessibility
- Strict URL token verification, scoped to single document.
- Contrast ≥ 4.5:1 on all amounts and labels.
- `aria-live="polite"` on payment/acceptance state updates.
