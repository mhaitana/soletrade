# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Soletrade Workspace
**Category:** Business workspace (B2B SaaS - solo traders, freelancers, gig operators)
**Direction:** Neutral Pro - ink-on-warm-white, flat, hairline, data-dense

---

## Direction rationale

The product is a B2B invoicing / books / quotes / gig-earnings tool. The aesthetic is **Vercel/Geist + Square-dashboard**:
calm, precise, high-information-density, flat. No decorative color, no card shadows, hairline borders only. One
restrained accent (blue) for links/focus/interactive; emerald is semantic-only (paid/success). Numerics render in
JetBrains Mono so amounts and document numbers align and read as "data".

## Color Palette

| Role | Hex (light) | CSS Variable |
|------|-------------|--------------|
| Background | `#FAFAF9` (stone-50) | `--color-background` |
| Foreground (ink) | `#1C1917` (stone-900) | `--color-foreground` |
| Card / paper | `#FFFFFF` | `--color-card` |
| Primary (ink) | `#1C1917` | `--color-primary` |
| On Primary | `#FAFAF9` | `--color-primary-foreground` |
| Muted surface | `#F5F4F1` (stone-100) | `--color-muted` |
| Muted text | `#57534E` (stone-600) | `--color-muted-foreground` |
| Border (hairline) | `#E7E5E4` (stone-200) | `--color-border` |
| Accent (single) | `#2563EB` (blue-600) | `--color-brand-blue` |
| Ring / focus | `#2563EB` | `--color-ring` |
| Success / paid | `#059669` (emerald-600) - **semantic only** | `--color-success` |
| Warning | `#EA580C` (orange-600) - **semantic only** | `--color-warning` |
| Destructive | `#DC2626` (red-600) | `--color-destructive` |

**Dark mode** is warm-tinted stone (`#0C0A09` bg, `#E7E5E4` fg, inverted ink primary). Defined in `globals.css :root`/`.dark`.

**Color rules**
- One accent. `--color-brand-blue` is the *only* non-semantic accent - links, focus rings, interactive highlights.
- Emerald/amber/red are **semantic**: paid, warning, destructive/overdue. Never decorative.
- Status badges use tinted variants (`bg-success/10 text-success`), not saturated fills. Always icon + text, never color alone.
- No raw hex in components - use tokens. No `bg-white`/`bg-[#...]` on app or public surfaces (use `bg-card`).

## Typography

- **Sans:** Inter (loaded via `next/font` as `--font-sans`).
- **Mono:** JetBrains Mono (loaded as `--font-mono`) - used for **numerics**: KPI values, table money/amount columns, document numbers, audit codes, prefix previews.
- **Body:** Inter 14px base (16px mobile). Line-height 1.5.
- **Headings:** Inter 600/700 - page title 24px (`text-2xl`), section 16px (`text-base font-semibold`), card title 14px.
- **Type scale:** 12 14 16 18 24 30.
- **Numbers:** `font-mono tabular-nums` on amount/quantity cells and KPI values; Inter `tabular-nums` for inline body numbers.

## Spacing (4/8 rhythm)

`--space-xs` 4px · `--space-sm` 8px · `--space-md` 16px · `--space-lg` 24px · `--space-xl` 32px · `--space-2xl` 48px · `--space-3xl` 64px.

## Radius & Elevation

- `--radius: 0.5rem` (8px). Scale: sm 0.3 · md 0.4 · lg 1.0 · xl 1.4 · 2xl 1.8 (× `--radius`).
- **No card shadows.** Cards are `rounded-xl border border-border bg-card` - flat, hairline only.
- **Overlays only** (Dialog, Sheet, DropdownMenu, Popover) keep a single `shadow-lg` for elevation separation from the flat surface layer.

## Component Specs

### Buttons
- **Primary (default):** `bg-primary text-primary-foreground` (ink) · `h-9 px-4` · `rounded-md` · 200ms color transition · hover `bg-primary/90`. No shadow.
- **Outline:** `border border-border bg-background hover:bg-muted` - hairline, flat.
- **Destructive:** `bg-destructive text-white` - reserved for delete/void/irreversible.
- **Ghost / Link:** link variant uses `text-brand-blue underline-offset-4 hover:underline`.
- One primary CTA per screen; secondary actions visually subordinate.

### Cards
- `rounded-xl border border-border bg-card` - **no shadow**. No lift on hover (layout-shift-avoid).
- Optional hover: subtle `hover:bg-muted/40` (color only, no transform).

### Inputs
- `h-9 rounded-md border border-input bg-transparent` - no shadow.
- Focus: `border-ring ring-[3px] ring-ring/40` (blue accent ring).

### Tables (use `<DataTable>` primitive)
- Hairline container `rounded-lg border border-border`, header `bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground`, divided rows, `hover:bg-muted/40`.
- Numeric columns: `text-right font-mono tabular-nums`.

### Lists (use `<ListRows>` primitive)
- `rounded-lg border border-border divide-y divide-border` - flat.

### Badges
- Tinted status variants: `success` (`bg-success/10 text-success border-success/20`), `warning`, `destructive`.
- `outline` for neutral; `secondary` for draft; `link` uses `text-brand-blue`.

### Modals / Sheets
- `shadow-lg` (overlays only). Backdrop `rgba(0,0,0,0.5)` + `backdrop-blur-sm`.

## Style Guidelines

**Style:** Minimalism / Neutral Pro (data-dense, flat, hairline)
**Keywords:** calm, precise, ink-on-paper, high-density, flat, hairline, mono numerics, single accent
**Effects:** 150–250ms color transitions only. No scale/translate hovers. No card shadows. Generous whitespace between sections; tight density within tables.

## Page Pattern (marketing landing)

**Pattern Name:** Minimal Single Column
- **Conversion:** Single primary CTA ("Get started"). Large headline. Lots of whitespace. No nav clutter.
- **Section Order:** 1. Hero headline + one-line description + primary CTA, 2. Module grid (flat hairline cards), 3. (optional) one-line social proof, 4. Footer.

## Anti-Patterns (Do NOT Use)

- ❌ **Card shadows** - flat hairline only (overlays excepted).
- ❌ **Multi-accent color** - one blue accent; emerald/amber/red are semantic only.
- ❌ **Raw hex / `bg-white` / `bg-[#...]`** on app or public surfaces - use tokens.
- ❌ **Saturated status badges** - use tinted variants.
- ❌ **Layout-shifting hovers** (scale/translate) - color/background only.
- ❌ **Emojis as icons** - Lucide SVG only.
- ❌ **Missing `cursor-pointer`** on clickable elements.
- ❌ **Low contrast text** - 4.5:1 minimum (test dark mode separately).
- ❌ **Instant state changes** - 150–300ms transitions.
- ❌ **Invisible focus states** - blue `ring-ring/40` ring required.
- ❌ **Decorative-only motion** - motion must convey state change; respect `prefers-reduced-motion`.

## Pre-Delivery Checklist

- [ ] No emojis as icons (Lucide SVG).
- [ ] No card shadows (hairline only).
- [ ] No raw hex in components (tokens only).
- [ ] Single accent + semantic colors only.
- [ ] Numerics in JetBrains Mono where specified.
- [ ] Focus rings visible (blue, 2–3px).
- [ ] Contrast 4.5:1 in both light and dark.
- [ ] `prefers-reduced-motion` respected.
- [ ] Responsive at 375 / 768 / 1024 / 1440.
- [ ] No content hidden behind fixed navbars; safe-area padding on mobile bottom nav.
- [ ] No horizontal scroll on mobile.