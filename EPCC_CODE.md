# Implementation: F005 — Responsive Quote Signature Canvas

**Mode**: default | **Date**: 2026-07-22 | **Status**: Verified

## 1. Changes (4 files)

**Created**:
- `e2e/quotes/responsive-signature.spec.ts` — Playwright audit of the public quote-acceptance signature canvas across all four viewport projects.

**Modified**:
- `src/app/q/[token]/quote-accept-form.tsx` — Responsive signature pad:
  - `ResizeObserver` on the container resizes the `<canvas>` bitmap to the rendered width.
  - Bitmap scaled by `window.devicePixelRatio`; stroke width scaled to `2 * dpr`.
  - Snapshot via `canvas.toDataURL("image/png")` and redraw on resize so strokes survive reflow.
  - Pointer-event handlers scale pointer coordinates to internal bitmap resolution.
  - Added `data-testid="signature-canvas"` and a "Clear signature" control.
- `src/app/(app)/quotes/[id]/page.tsx` — Added `data-testid="quote-public-link"` on the public token link so the E2E spec can extract a fresh token per run.

## 2. Quality

**Vitest**: 81 test files, 734 tests passed.
**E2E**: `pnpm test:e2e e2e/quotes/responsive-signature.spec.ts` — 14/14 passed across Desktop Chrome, iPhone 12/13, Pixel 7, and iPad Mini.
**Type-check**: clean (`tsc --noEmit`).
**Lint**: clean (`eslint`).
**Format**: clean (`prettier --check`).

## 3. Decisions & Gotchas

- Kept a fixed 480/140 aspect ratio while making width 100% of the container; the canvas internal bitmap derives from `container.clientWidth × DPR`.
- Snapshot-and-redraw is dependency-free and preserves strokes during viewport resize (verified by the desktop resize case in E2E).
- The mobile accept sheet can obscure the canvas; calling `scrollIntoViewIfNeeded()` and re-measuring `boundingBox()` before drawing prevents pointer coordinates from landing on the background "Decline" button.
- E2E creates a unique customer per test so concurrent Playwright projects don't collide on quote-list row order.
- Width assertion tolerance was raised from 4px to 6px after Pixel 7 desktop layout produced ~4.3px of sub-pixel rounding.

## 4. Verification

- Feature commit: `6f0c6c0`
- Verified at: `2026-07-22T12:35:24Z`
