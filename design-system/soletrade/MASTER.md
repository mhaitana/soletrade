# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Soletrade
**Category:** Business workspace (B2B SaaS - solo traders, freelancers, gig operators)
**Direction:** Editorial Precision (Uber × Airbnb) - Obsidian ink authority, deep cobalt accent, warm alabaster canvas, continuous squircle radii, 3-tier ambient paper depth

---

## Direction Rationale

The product is a modern business operating system bringing invoices, books, quotes, receipts, mileage, and earnings together.
The aesthetic is **Editorial Precision (Uber × Airbnb)**:
- **Uber Base Design System (Operational Precision):** Obsidian ink authority (`#141413` light / `#F5F4F0` dark), tactile telemetry, semantic status pills, high-density financial numerics in `JetBrains Mono tabular-nums`.
- **Airbnb Design Language System (Warm Editorial Hospitality):** Warm alabaster canvas (`#F9F8F6`), continuous squircle curves, layered ambient depth (`--shadow-xs`, `--shadow-md`, `--shadow-xl`), and refined Deep Cobalt (`#1D4ED8` light / `#3B82F6` dark).

## Color Palette

| Role | Hex (light) | Hex (dark) | CSS Variable |
|------|-------------|------------|--------------|
| Canvas Background | `#F9F8F6` | `#0A0A09` | `--color-background` |
| Foreground (Ink) | `#141413` | `#F5F4F0` | `--color-foreground` |
| Card / Paper | `#FFFFFF` | `#141413` | `--color-card` |
| Muted Surface / Tile | `#F2F0EC` | `#1E1D1B` | `--color-muted` |
| Muted Text | `#65625C` | `#A39E93` | `--color-muted-foreground` |
| Primary CTA (Ink) | `#141413` | `#F5F4F0` | `--color-primary` |
| On Primary | `#FFFFFF` | `#141413` | `--color-primary-foreground` |
| Deep Cobalt Accent | `#1D4ED8` | `#3B82F6` | `--color-brand-blue` |
| Accent Tint | `#EFF6FF` | `#172554` | `--color-accent` |
| Border (Architectural) | `#E6E4DF` | `#262522` | `--color-border` |
| Success / Paid | `#059669` | `#34D399` | `--color-success` |
| Warning / Review | `#D97706` | `#FBBF24` | `--color-warning` |
| Destructive / Overdue | `#E11D48` | `#FB7185` | `--color-destructive` |

**Color rules**
- Primary CTAs and critical headers use obsidian ink.
- Deep Cobalt (`--color-brand-blue`) is reserved for interactive focus rings, interactive text links, and `hAI` assistant sparks.
- Success, warning, and destructive are strictly semantic.
- Status badges use semantic tinted variants (`bg-success/10 text-success border border-success/20`).
- No raw hex in components - use CSS tokens.

## Typography

- **Sans:** Inter (loaded via `next/font` as `--font-sans`).
- **Mono:** JetBrains Mono (loaded as `--font-mono`) - used for **numerics**: KPI values, table money/amount columns, document numbers, audit codes, and mileage figures with `tabular-nums`.
- **Body:** Inter 14px base (`16px` on mobile for iOS tap-zoom prevention). Line-height 1.5.
- **Headings:** Inter 600/700 - page title 24px (`text-2xl font-semibold tracking-tight`), section 16px (`text-base font-semibold`), card title 14px.
- **Type scale:** 12, 14, 16, 18, 24, 30.

## Radius & Elevation Scale

- **Radius:**
  - `rounded-lg` (10px): Inputs, buttons, segmented controls.
  - `rounded-xl` (12-14px): Popovers, dropdown menus.
  - `rounded-2xl` (16px): Bento cards, dashboard panels, data table containers.
  - `rounded-3xl` (22px): Hero preview cards, public payment sheets, modal dialogs.
  - `rounded-full` (9999px): Badges, telemetry pills, floating quick-actions.
- **Elevation (3-tier ambient paper depth):**
  - `--shadow-xs`: `0 1px 2px rgba(20, 20, 19, 0.04), 0 0 0 1px var(--border)` (resting cards, table containers).
  - `--shadow-md`: `0 8px 24px -4px rgba(20, 20, 19, 0.08), 0 2px 6px -1px rgba(20, 20, 19, 0.04)` (interactive hover, flyouts).
  - `--shadow-xl`: `0 20px 40px -12px rgba(20, 20, 19, 0.16)` (floating dialogs, sheets, bottom drawers).

## Component Specs

### Buttons
- **Primary:** `bg-primary text-primary-foreground` (obsidian ink) · `h-10 px-4` · `rounded-lg font-medium` · `active:scale-[0.99] transition-all` · hover `bg-primary/90`.
- **Large CTA:** `h-12 px-7 rounded-xl text-base font-semibold`.
- **Outline:** `border border-border bg-card hover:bg-muted text-foreground` with `shadow-xs`.
- **Destructive:** `bg-destructive text-white hover:bg-destructive/90`.
- **Ghost / Link:** `text-brand-blue underline-offset-4 hover:underline`.
- Mobile tap targets must maintain minimum `min-h-11` (44px).

### Cards
- `rounded-2xl border border-border/80 bg-card p-6 shadow-xs transition-shadow hover:shadow-md`.

### Inputs
- `h-10 rounded-lg border border-input bg-card px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40`.

### Segmented Controls
- Airbnb-style slider: container `rounded-xl bg-muted p-1 border border-border/40`.
- Active item: `rounded-lg bg-card text-foreground shadow-xs font-medium`.

### Tables (use `<DataTable>` primitive)
- Container: `rounded-2xl border border-border bg-card shadow-xs overflow-x-auto`.
- Header: `bg-muted/40 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80`.
- Numeric columns: `text-right font-mono tabular-nums`.

### Badges & Status Pills
- High-visibility pill: `rounded-full px-2.5 py-0.5 text-xs font-medium`.
- Tinted status variants:
  - Paid/Accepted: `bg-success/10 text-success border border-success/20`.
  - Pending/Warning: `bg-warning/10 text-warning border border-warning/20`.
  - Overdue/Declined: `bg-destructive/10 text-destructive border border-destructive/20`.
  - Draft/Neutral: `bg-muted text-muted-foreground border border-border`.

## Anti-Patterns (Do NOT Use)

- ❌ Harsh 1px-only wireframes with zero paper elevation.
- ❌ Saturated, fluorescent badge fills without tinted backgrounds.
- ❌ Low-contrast text below 4.5:1 ratio.
- ❌ Generic royal blue or purple accents; use Deep Cobalt (`#1D4ED8` / `#3B82F6`).
- ❌ Raw hex values in components - strictly use CSS variables/tokens.
- ❌ Missing `tabular-nums` or non-mono fonts on financial/mileage figures.
