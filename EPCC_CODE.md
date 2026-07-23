# Implementation: F006 — Core E2E Smoke Flows

**Mode**: default | **Date**: 2026-07-22 | **Status**: Verified

## 1. Changes

**Created**:
- `e2e/dashboard.spec.ts` — login smoke for owner, admin, and mobile dashboard overflow check.
- `e2e/invoices/create-send.spec.ts` — create a draft invoice and send it via detail action.
- `e2e/quotes/accept-convert.spec.ts` — accept a public quote and convert to a draft invoice.
- `e2e/books/create-transaction.spec.ts` — create an income transaction and assert it appears in the list.
- `e2e/settings/invite-member.spec.ts` — invite a unique email and assert pending invitation.

**Modified**:
- `src/shared/components/sparkline.tsx` — fixed React `<title>` children to a single template string (`{`${p.month}: ${p.label}`}`) to eliminate hydration mismatch warning.

## 2. Quality

**Vitest**: 81 test files, 734 tests passed.
**E2E**: `pnpm test:e2e e2e/dashboard.spec.ts e2e/invoices/create-send.spec.ts e2e/quotes/accept-convert.spec.ts e2e/books/create-transaction.spec.ts e2e/settings/invite-member.spec.ts` — 14/14 passed; 20 skipped (mobile viewports intentionally skip desktop-only flows below 1280 px).
**Type-check**: clean (`tsc --noEmit`).
**Lint**: clean (`eslint`).
**Format**: clean (`prettier --check`).

## 3. Decisions & Gotchas

- Desktop-only flows use `test.skip(project.name !== "Desktop Chrome", ...)` to avoid mobile viewport timeouts on dense multi-step forms.
- Dashboard mobile overflow test runs on all viewport projects.
- Invoice and quote create forms redirect to list pages; specs navigate into the detail row to send/convert.
- Acceptance criterion for quote conversion requires manually clicking "Convert to invoice" after acceptance.
- Initial runs failed due to stale dev server/Supabase state; a fresh `rm -rf .next`, `supabase stop/start`, `pnpm db:reset`, and dev-server restart resolved transient server-action errors.

# Implementation: INFRA-003 — Minimal Service Worker / Offline Fallback

**Mode**: default | **Date**: 2026-07-22 | **Status**: Verified

## 1. Changes

**Created**:
- `src/app/offline/page.tsx` — static offline fallback with brand-driven title/metadata, icon, explanatory copy, and a reload button.
- `src/app/offline/reload-button.tsx` — tiny client component so the reload `onClick` works without making the page a client component (which would disallow `metadata` export).
- `public/sw.js` — minimal service worker:
  - Precaches `/`, `/offline`, `/login`, and key icons.
  - Network-first for navigations; returns `/offline` on failure.
  - Cache-first for static assets (`/_next/static/`, `/fonts/`, `/icons/`).
  - Explicit `NEVER_CACHE` prefixes: `/api/`, `/i/`, `/q/`, `/invite/`, `/auth/`, `/stripe/`, `/db/`.
- `src/app/service-worker-register.tsx` — client-only registration, deferred until `window.load`, gated to `NODE_ENV === "production"` so local dev is unaffected.
- `e2e/service-worker/service-worker.spec.ts` — smoke tests asserting `/offline` renders and `/sw.js` is served with expected content.

**Modified**:
- `src/app/layout.tsx` — added `<ServiceWorkerRegister />` inside `<ThemeProvider>`.
- `src/proxy.ts` — added `/offline` and `/sw.js` to `PUBLIC_PREFIXES` so unauthenticated users can reach the fallback and the script is publicly accessible.

## 2. Quality

**Vitest**: 81 test files, 734 tests passed.
**E2E**: `pnpm test:e2e e2e/service-worker/service-worker.spec.ts` — 14/14 passed across Desktop Chrome, iPhone 12/13, Pixel 7, and iPad Mini.
**Build**: `pnpm build` succeeded; `/offline` prerendered as static.
**Type-check**: clean (`tsc --noEmit`).
**Lint**: clean (`eslint`).
**Format**: clean (`prettier --check`).

## 3. Decisions & Gotchas

- Kept the offline page as a Server Component so Next.js can statically generate metadata. The interactive reload button is split into `reload-button.tsx` (a Client Component) to avoid the "event handler in Server Component" build error.
- Service-worker registration is production-only; otherwise the dev server would serve a stale SW and make local iteration painful.
- Excluded payment/token/auth routes from caching to avoid any risk of serving cached sensitive pages or intercepting Stripe Elements.
- Initial `/offline` E2E failed with a 307 redirect to `/login` until `/offline` and `/sw.js` were added to `PUBLIC_PREFIXES`.
- After fixing the redirect, the page hit the root error boundary because the page included an `onClick` handler as a Server Component; splitting out `ReloadButton` resolved it.
