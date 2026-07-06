# Page Override — App Dashboard & Shell

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for the authenticated app shell, dashboard, and all module list/detail pages. Where this file is silent, MASTER.md applies.

## Why this override exists
MASTER.md defines the Neutral Pro system; this file pins the in-app shell + dashboard specifics (density, navigation, KPI/summary cards). The in-app surface is a **data-dense business tool** — flat, hairline, mono numerics.

## Layout shell
- **Desktop (≥1024px):** fixed left sidebar (`w-64`), top bar (workspace switcher + global search + account menu), main content `max-w-7xl` centered with `px-8 py-6`.
- **Mobile (<768px):** top bar (workspace avatar + search icon + hamburger), main content `px-4 pb-24 pt-6`, fixed **bottom navigation** (max 5 items, icon+label, 44pt targets, safe-area padding `pb-[env(safe-area-inset-bottom)]`).
- **Tablet (768–1023px):** sidebar visible; no bottom nav.
- Reserve top-bar height on main content so the fixed header never overlaps first section.
- Use `min-h-dvh` not `100vh`.

## Navigation rules (only show enabled modules)
- Primary nav items: Dashboard, Assistant, [installed modules], Customers, Files, Activity, Audit log, Billing, Settings.
- Module items render **only when** installed. Disabled modules surface under a dashed "Add module" entry — never silently hide them (empty-nav-state rule).
- Active item: `bg-muted text-foreground` (no border, flat — Neutral Pro). Inactive: `text-muted-foreground hover:bg-muted/60 hover:text-foreground`.
- Icon + label required together (nav-label-icon). Lucide icons, `size-4`, stroke 1.5.
- Bottom nav: 5 items max (4 pinned + "More" sheet).

## Dashboard cards (summaries, not vanity)
- KPI cards: value rendered in **JetBrains Mono** (`font-mono tabular-nums`), label, delta vs previous period with arrow icon + accessible text ("+12% vs last month"). Never color-only meaning — include icon + text.
- Trend over time → `<Sparkline>` (ink primary `--chart-1`, blue secondary `--chart-2`); color-not-only.
- Grid: 1 col mobile, 2 col `sm`, 4 col `lg`. Gap `gap-4`.
- Every card needs loading (skeleton), empty ("No X yet" + CTA), and error states.

## Tables & lists (use the shared primitives)
- List pages use `<DataTable>` (invoices, quotes, books, drive, billing ledger) or `<ListRows>` (customers, files, audit, activity).
- Money / quantity / amount columns: `numeric` → `text-right font-mono tabular-nums`.
- Document-number columns: `font-mono text-xs`.
- Status filters / period selectors: `<SegmentedControl>` (single bordered group, active item lifts to `bg-card` with hairline border).

## Typography in-app
- Body: **Inter** 14px base (16px mobile). Line-height 1.5.
- Headings: Inter 600/700 — page title 24px (`text-2xl font-semibold tracking-tight`), section 16px, card title 14px.
- Numbers/money: **JetBrains Mono** `font-mono tabular-nums` for KPI values and table amount columns; Inter `tabular-nums` for inline body numbers.
- Type scale: 12 14 16 18 24 30.

## Color usage in-app
- Background `--background` (warm-white), cards `bg-card` with `border border-border` (hairline) — **no shadow**.
- Primary `--primary` (ink) for active states and key CTAs. Single accent `--brand-blue` for links/focus/interactive.
- `--success` (emerald) **only** for paid/positive states; `--destructive` for overdue/void; `--warning` for caution. All semantic.
- Status badges: draft (`secondary`), sent (`default`), viewed (`secondary`), paid (`success`), overdue (`destructive`), void (`destructive`). Always icon + text, never color alone.

## Motion
- Color/background transitions 150–250ms. No scale/translate. List item entrance stagger 30–50ms. Respect `prefers-reduced-motion` (disable stagger + chart entrance anim). No decorative motion.

## Accessibility (in-app, non-negotiable)
- Focus rings visible (blue `ring-ring/40`, 3px). Keyboard tab order follows visual order.
- All icon-only buttons (search, menu, account, theme) need `aria-label`.
- Tables: `<th scope>`, `aria-sort` on sortable columns, `text-left` default (numeric columns `text-right`).
- Skip link "Skip to main content" is the first focusable element.
- `aria-current="page"` on the active nav item and active filter/segmented-control item.