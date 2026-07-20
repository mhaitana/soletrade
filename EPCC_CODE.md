# Implementation: INFRA-001 — Playwright E2E Scaffold

**Mode**: default | **Date**: 2026-07-20 | **Status**: Complete

## 1. Changes (8 files)

**Created**:
- `playwright.config.ts` — Playwright config with `testDir: "./e2e"`, Desktop Chrome / iPhone 12 / Pixel 7 / iPad Mini projects, `webServer` for `pnpm dev`, and global setup/teardown hooks.
- `e2e/setup/global.ts` — Starts Supabase if needed and runs `pnpm db:reset` once before specs.
- `e2e/setup/teardown.ts` — Stops Supabase in CI; leaves it running in local dev.
- `e2e/health.spec.ts` — Smoke test asserting the seeded `/login` page renders across all viewports.

**Modified**:
- `package.json` — Added `test:e2e`, `test:e2e:ui`, and `test:e2e:ci` scripts.
- `.env.example` — Added `PLAYWRIGHT_BASE_URL` documentation.
- `README.md` — Added E2E setup/running section and listed the new scripts.
- `.gitignore` — Ignored `e2e/test-results/`, `e2e/.auth/`, `e2e/report/`, `playwright-report/`, and `playwright/.cache/`.

## 2. Quality

**Vitest**: 81 test files, 734 tests passed.
**E2E**: `pnpm test:e2e` — 4/4 passed (Desktop Chrome, iPhone 12/13, Pixel 7, iPad Mini).
**Type-check**: clean (`tsc --noEmit`).
**Lint**: clean (`eslint`).
**Format**: clean (`prettier --check`).

## 3. Decisions

- **Use `pnpm dev` as `webServer` command**: Fastest iteration. `reuseExistingServer: !process.env.CI` lets a developer keep a dev server running. CI gets a clean boot.
- **Global setup runs `pnpm db:reset` once**: Keeps every spec deterministic against `supabase/seed.sql`. The setup starts Supabase only if it is not already running, and teardown stops it only in CI.
- **Health spec first, role fixtures later**: INFRA-001 only verifies the harness works. Auth fixtures and workflow specs are deferred to INFRA-002 / Phase 7 per the approved plan.

## 4. Handoff

**Run**: `/epcc-commit` when ready.
**Blockers**: None.
**TODOs**: Implement INFRA-002 (auth fixtures for seeded roles) and Phase 7 workflow specs (dashboard, invoice create/send, quote accept, books transaction, invite member).
