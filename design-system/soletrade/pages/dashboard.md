# Page Override - App Dashboard & Shell

**Overrides:** This file overrides `design-system/soletrade/MASTER.md` for the authenticated app shell, dashboard, and all module list/detail pages. Where this file is silent, MASTER.md applies.

## Why this override exists
Pins the in-app shell + dashboard specifics for Editorial Precision: tactile navigation, high-contrast obsidian indicators, 2×2 Bento KPI tiles, and monospace tabular financial data.

## Layout shell
- **Desktop (≥1024px):** fixed left sidebar (`w-64`), top bar (workspace switcher + global search + account menu), main content `max-w-7xl` centered with `px-8 py-6`.
- **Mobile (<768px):** top bar (workspace avatar + search icon + hamburger), main content `px-4 pb-24 pt-6`, fixed **bottom navigation** (frosted glass `bg-background/90 backdrop-blur-md`, safe-area padding `pb-[env(safe-area-inset-bottom)]`).
- **Tablet (768–1023px):** sidebar visible; no bottom nav.
- Reserve top-bar height on main content so the fixed header never overlaps first section.
- Use `min-h-dvh` not `100vh`.

## Navigation rules (only show enabled modules)
- Primary nav items: Dashboard, Assistant, [installed modules], Customers, Files, Activity, Audit log, Billing, Settings.
- Module items render **only when** installed. Disabled modules surface under a dashed "Add module" entry - never silently hide them (empty-nav-state rule).
- Active sidebar item: high-contrast tactile obsidian indicator (`bg-foreground text-background shadow-xs rounded-lg font-medium`). Inactive: `text-muted-foreground hover:bg-muted/60 hover:text-foreground rounded-lg`.
- Icon + label required together. Lucide icons, `size-4`, stroke 1.5.
- Bottom nav: 5 items max (4 pinned + "More" sheet), active item highlighted with cobalt tint or obsidian foreground.

## Dashboard cards & Bento layout
- KPI cards: `rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs transition-all hover:shadow-md`.
- Values rendered in **JetBrains Mono** (`font-mono text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums`).
- Delta vs previous period: tactile status badge with pill styling (`rounded-full bg-success/10 text-success border border-success/20 px-2 py-0.5 text-xs font-medium`).
- Trend over time → `<Sparkline>` (`--chart-1` ink primary, `--chart-2` cobalt secondary).
- Grid: 2 compact columns on mobile, 2 col `sm`, 4 col `lg`. Fluid gap-3 to gap-4.
- Every card needs loading (skeleton), empty ("No X yet" + CTA), and error states.

## Tables & lists (use the shared primitives)
- List pages use `<DataTable>` in `rounded-2xl border border-border bg-card shadow-xs overflow-x-auto`.
- Header: `bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80`.
- Money / quantity / amount columns: `numeric` → `text-right font-mono tabular-nums`.
- Document-number columns: `font-mono text-xs`.
- Status filters: `<ResponsiveFilter>` wrapping `<SegmentedControl>` (Airbnb-style pill track).

## Typography & Color in-app
- Body: **Inter** 14px base (16px mobile). Line-height 1.5.
- Headings: Inter 600/700 - page title 24px (`text-2xl font-semibold tracking-tight`), section 16px, card title 14px.
- Numbers/money: **JetBrains Mono** `font-mono tabular-nums`.
- Background: `--background` (warm alabaster `#F9F8F6`). Cards: `bg-card` with `border border-border/80` and `--shadow-xs`.
- Primary `--primary` (obsidian `#141413`). Single accent `--brand-blue` (`#1D4ED8` light / `#3B82F6` dark).

## Accessibility
- Focus rings visible (blue `ring-ring/40`, 3px).
- All icon-only buttons need `aria-label`.
- `aria-current="page"` on the active nav item and active filter item.
