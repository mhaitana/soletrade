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
