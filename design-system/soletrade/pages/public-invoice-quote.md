# Page Override - Public Invoice & Quote Pages (mobile-first)

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for the **public, customer-facing** invoice payment page and quote acceptance page. These are the highest-stakes polish surfaces - they're viewed on phones, by people who are not logged in, and they must look trustworthy.

## Core principles
- Mobile-first, single column, `max-w-md mx-auto` on desktop (don't stretch a payment page across a wide screen).
- No app shell, no sidebar, no bottom nav. Minimal top bar with brand wordmark only.
- Generous whitespace, **hairline borders, no shadow on the card** - flat, premium, paper-like.
- Must load fast (public page, no auth round-trip) - Server Component, minimal client JS, only Stripe Elements client-side.
- **Token-driven only** - no hardcoded `bg-[#F8FAFC]`/`bg-white`. Use `bg-background`, `bg-card`, `border-border`.

## Layout
- Top: brand wordmark (`font-mono text-sm font-semibold tracking-tight`, left), status badge (right).
- Hero block: document type label ("Invoice" / "Quote"), document number (`font-mono`), customer/business names.
- Amount block: large total in **JetBrains Mono** (`font-mono tabular-nums text-4xl font-semibold`). Currency code visible.
- Line items: stacked rows on mobile (label left, value right), not a horizontal-scroll table (horizontal-scroll rule). On ≥640px allow a real table.
- Totals: subtotal, tax/GST (labelled with rate), total - right aligned, `font-mono tabular-nums`.
- For invoices: Stripe payment button (Apple Pay / Google Pay / card) - primary CTA, full width, sticky bottom on mobile. For quotes: "Accept" + "Decline", Accept is primary.
- Footer: business contact, issue/date/expiry, terms link.

## Forms & feedback (critical on mobile)
- Card input: use Stripe Elements (handles Apple Pay / Google Pay). Never build custom card fields.
- Show loading state on Pay button (spinner + "Processing…"), disable to prevent double-charge (loading-buttons rule).
- Success: clear confirmation screen with checkmark + paid amount + receipt reference. Failure: error message near button with retry path (error-recovery rule).
- All inputs ≥44px height (touch-friendly-input). `inputmode` set correctly. Labels visible, not placeholder-only.
- Acceptance flow: confirm modal "Accept this quote?" with explicit Confirm/Cancel (confirmation-dialogs).

## Security & access (public surface)
- Rate limit the public endpoint (prevent enumeration).
- Token in URL must be unguessable (signed/random), scoped to one document, not the workspace ID.
- No cross-workspace data leakage: public page renders only the document it was issued for.
- Log view events server-side (invoice viewed / quote viewed) - never expose workspace-internal IDs in the HTML.

## Typography
- Inter throughout. Total/amount: **JetBrains Mono** `font-mono tabular-nums` 30–36px. Body 16px mobile. Document number `font-mono` (tabular, copyable).

## Color
- Background `bg-background` (warm-white). Card `bg-card`, `border border-border` - **no shadow**.
- Paid/Accepted → `--success` (emerald, tinted `bg-success/10` for surfaces). Declined/Overdue → `--destructive`. Pending → `--muted-foreground`/`secondary`.
- Primary CTA: ink (`bg-primary`) for Accept; Stripe-branded blue (`#635BFF`) is acceptable for the Stripe Pay button since it's Stripe-branded. One primary CTA per screen (primary-action rule).

## Motion
- Subtle: status badge fade-in 200ms. No parallax, no decorative animation. Respect `prefers-reduced-motion`.

## Accessibility
- Contrast 4.5:1 on all amounts and labels (these matter - people are paying money).
- Focus ring visible on Pay/Accept. Keyboard-reachable. Screen reader announces amount and status.
- The payment result must use `aria-live="polite"` so screen readers announce success/failure (toast-accessibility).