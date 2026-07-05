# Page Override — Public Invoice & Quote Pages (mobile-first)

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for the **public, customer-facing** invoice payment page and quote acceptance page. These are the highest-stakes polish surfaces — they're viewed on phones, by people who are not logged in, and they must look trustworthy.

## Core principles
- Mobile-first, single column, `max-w-md mx-auto` on desktop (don't stretch a payment page across a wide screen).
- No app shell, no sidebar, no bottom nav. Minimal top bar with brand wordmark only.
- Generous whitespace, soft borders, subtle shadow on the card. Premium but approachable.
- Must load fast (public page, no auth round-trip) — Server Component, minimal client JS, only Stripe Elements client-side.

## Layout
- Top: brand wordmark (left), status badge (right).
- Hero block: document type label ("Invoice" / "Quote"), document number, customer/business names.
- Amount block: large total, tabular-nums, `text-4xl font-semibold`. Currency code visible.
- Line items table: stacked rows on mobile (label left, value right, dotted leader optional), not a horizontal-scroll table (horizontal-scroll rule). On ≥640px allow a real table.
- Totals: subtotal, tax/GST (labelled with rate), total — right aligned, tabular-nums.
- For invoices: Stripe payment button (Apple Pay / Google Pay / card) — primary CTA, full width, sticky bottom on mobile. For quotes: "Accept" + "Decline" buttons, Accept is primary.
- Footer: business contact, issue/date/expiry, terms link.

## Forms & feedback (critical on mobile)
- Card input: use Stripe Elements (handles Apple Pay / Google Pay). Never build custom card fields.
- Show loading state on Pay button (spinner + "Processing…"), disable to prevent double-charge (loading-buttons rule).
- Success: clear confirmation screen with checkmark + paid amount + receipt reference. Failure: error message near button with retry path (error-recovery rule).
- All inputs ≥44px height (touch-friendly-input). `inputmode` set correctly. Labels visible, not placeholder-only (form-labels rule).
- Acceptance flow: confirm modal "Accept this quote?" with explicit Confirm/Cancel (confirmation-dialogs).

## Security & access (public surface)
- Rate limit the public endpoint (rate-limit auth-sensitive endpoints rule applies here too — prevent enumeration).
- Token in URL must be unguessable (signed/random), scoped to one document, not the workspace ID.
- No cross-workspace data leakage: public page renders only the document it was issued for.
- Log view events server-side (invoice viewed / quote viewed) — but never expose workspace-internal IDs in the HTML.

## Typography
- Inter throughout. Total/amount: Inter tabular-nums 30–36px. Body 16px mobile. Document number `font-mono` (tabular, copyable).

## Color
- Background `#F8FAFC`. Card `#FFFFFF`, `border`, `shadow-sm`.
- Paid/Accepted → `#059669`. Declined/Overdue → `#DC2626`. Pending → slate.
- Primary CTA: Stripe blue (`#635BFF`) is acceptable for the Pay button since it's Stripe-branded; otherwise brand `#1E3A5F`. One primary CTA per screen (primary-action rule).

## Motion
- Subtle: status badge fade-in 200ms, button press scale 0.97. No parallax, no decorative animation. Respect `prefers-reduced-motion`.

## Accessibility
- Contrast 4.5:1 on all amounts and labels (these matter — people are paying money).
- Focus ring visible on Pay/Accept. Keyboard-reachable. Screen reader announces amount and status.
- The payment result must use `aria-live="polite"` so screen readers announce success/failure (toast-accessibility).