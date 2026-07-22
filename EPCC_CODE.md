# Implementation: F004 — Mobile Dense Table Variants

**Mode**: default | **Date**: 2026-07-22 | **Status**: Verified

## 1. Changes (6 files)

**Created**:
- `e2e/mobile/dense-tables.spec.ts` — Playwright audit for invoice/quote line-item tables and tax lodged-quarters table collapsing into stacked cards on narrow viewports, plus desktop assertions that tables remain visible at 1280px.

**Modified**:
- `src/app/(app)/books/books-summary.tsx` — Added mobile card-row variant for income/expense category breakdown below `sm` (`data-testid="books-category-mobile"`).
- `src/app/(app)/books/tax/page.tsx` — Added mobile card-row variant for lodged GST/BAS quarters below `sm` (`data-testid="tax-lodged-mobile"`), kept desktop table intact.
- `src/app/(app)/invoices/[id]/page.tsx` — Renders invoice line items as stacked cards below `sm` (`data-testid="invoice-line-items-mobile"`).
- `src/app/(app)/quotes/[id]/page.tsx` — Renders quote line items as stacked cards below `sm` (`data-testid="quote-line-items-mobile"`).
- `src/shared/components/bar-chart.tsx` — Minor Prettier cleanup: collapsed `<title>` children to a single template literal.

## 2. Quality

**Vitest**: 81 test files, 734 tests passed. One transient PostgREST hiccup under full concurrent load; the affected tests pass when run in isolation.
**E2E**: `pnpm test:e2e e2e/mobile/dense-tables.spec.ts --project="iPhone 12/13" --project="Desktop Chrome"` — 11/11 passed, 5 correctly skipped by viewport filter.
**Type-check**: clean (`tsc --noEmit`).
**Lint**: clean (`eslint`).
**Format**: clean (`prettier --check`).

## 3. Decisions

- **Responsive toggle pattern**: Used `hidden sm:table` for desktop tables and `sm:hidden` for mobile card rows. This preserves the existing desktop markup and avoids layout shifts on larger screens.
- **No new dependencies**: Reused Tailwind responsive utilities and existing `Card`/`Badge` primitives from the design system.
- **Overflow assertion in E2E**: `assertNoHorizontalOverflow` compares `document.documentElement.scrollWidth > window.innerWidth` to catch pinch-zoom regressions on real narrow viewports.

## 4. Handoff

**Run**: `/epcc-commit` when ready.
**Blockers**: None.
**TODOs**: Verify F004 is recorded in `epcc-features.json`; move on to next pending feature.
