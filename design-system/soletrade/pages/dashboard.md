# Page Override — App Dashboard & Shell

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for the authenticated app shell, dashboard, and all module list/detail pages. Where this file is silent, MASTER.md applies.

## Why this override exists
MASTER.md targets the marketing landing (App Store Style Landing, Poppins, large type). The in-app surface is a **data-dense business tool**, not a marketing page. Typography, density, and navigation differ.

## Layout shell
- **Desktop (≥1024px):** fixed left sidebar (w-64, collapsible to w-16 icon rail), top bar (workspace switcher + global search + account menu), main content max-w-7xl centered with `px-6 py-8`.
- **Mobile (<768px):** top bar (workspace avatar + search icon + hamburger), main content `px-4 py-5`, fixed **bottom navigation** (max 5 items, icon+label, 44pt targets, safe-area padding `pb-env`).
- **Tablet (768–1023px):** collapsible drawer sidebar (slide-over), no bottom nav.
- Reserve `pt-16` on main content so fixed top bar never overlaps first section (Sticky Navigation rule).
- Use `min-h-dvh` not `100vh` (mobile viewport units rule).

## Navigation rules (only show enabled modules)
- Primary nav items: Dashboard, Customers, Invoices, Books, Drive, Quotes, Files, Activity, Billing, Settings.
- Module items (Invoices, Books, Drive, Quotes) render **only when** that module is installed for the active workspace. Disabled modules surface under a single "Add module" entry that leads to the enable/upgrade screen — never silently hide them (empty-nav-state rule).
- Active item: `text-primary` + left 2px primary border + `bg-muted` (Active State rule).
- Icon + label required together (nav-label-icon rule). Lucide icons, 20px, stroke 1.5.
- Bottom nav: 5 items max. Pin Dashboard + Customers + 2 most-recently-used modules + Settings overflow ("More" sheet for the rest).

## Dashboard cards (summaries, not vanity)
- KPI cards: numeric value (tabular-nums, `font-variant-numeric: tabular-nums`), label, delta vs previous period with arrow icon + accessible text ("+12% vs last month"). Never color-only meaning — include icon + text.
- Use **bullet chart grid** for 3+ KPIs vs target (chart domain result). Single KPI vs target → gauge. Trend over time → line chart (Recharts), primary `#2563EB`, fill 20% opacity, dashed line for secondary series (color-not-only).
- Grid: 1 col mobile, 2 col `sm`, 3 col `lg`, 4 col `xl`. Gap `gap-4 md:gap-6`.
- Every card needs loading (skeleton shimmer), empty ("No invoices yet — create your first" + CTA), and error states.
- Cash position / outstanding / revenue cards use tabular figures to prevent layout shift.

## Typography in-app
- Body: **Inter** 14px base, 16px on mobile (readable-font-size). Line-height 1.5.
- Headings: Inter 600/700 — page title 24px (`text-2xl`), section 16px (`text-base font-semibold`), card title 14px.
- Numbers/money: Inter tabular-nums. Do not use Poppins inside the app (it's for marketing only).
- Type scale: 12 14 16 18 24 30 (font-scale rule).

## Color usage in-app
- Background `#F8FAFC`, surface cards `#FFFFFF` with `border border-[#E4E7EB]` + `shadow-sm`.
- Primary `#1E3A5F` for active states, key CTAs. Secondary `#2563EB` for links/interactive.
- Accent `#059669` (paid green) **only** for success/paid/positive-money states. Destructive `#DC2626` for overdue/danger.
- Status badges: draft (slate), sent (blue), viewed (slate), paid (green), overdue (red), cancelled (slate line-through). Always icon + text, never color alone.

## Motion
- Page/section transitions 200ms ease-out. List item entrance stagger 30–50ms. Respect `prefers-reduced-motion` (disable stagger + chart entrance anim). No decorative motion.

## Accessibility (in-app, non-negotiable)
- Focus rings visible 2px `--color-ring`. Keyboard tab order follows visual order.
- All icon-only buttons (search, menu, account) need `aria-label`.
- Tables: `<th scope>`, `aria-sort` on sortable columns, zebra rows optional, `text-left` default.
- Skip link "Skip to main content" first focusable element.