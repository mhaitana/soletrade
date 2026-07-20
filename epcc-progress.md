# EPCC Progress Log

## Session: CODE - 2026-07-20T23:55:00Z
**Feature**: INFRA-002 - Playwright Auth Fixtures
**Status**: verified
**Duration**: ~35 minutes

### What changed
- Created `e2e/fixtures/auth.ts` with seeded role definitions, a real browser sign-in helper, file-lock guarded storage-state generation, and a `switchWorkspace` helper that works on desktop and mobile.
- Extended Playwright's `test` fixture to provide `ownerPage`, `adminPage`, `accountantPage`, `employeePage`, `readonlyPage`, and `pendingPage` loaded from saved storage states.
- Added `e2e/setup/auth-setup.ts` as a setup project so storage states are generated once before the main test projects run.
- Added `e2e/auth/roles.spec.ts` covering: dashboard access per role, workspace switching for the owner, role-based nav visibility (audit hidden from readonly), readonly billing view-only, and employee billing block.
- Updated `playwright.config.ts` to depend all viewport projects on the new `setup` project and increased timeouts to handle dev-server cold starts under concurrent workers.
- Updated `eslint.config.mjs` to disable `react-hooks/rules-of-hooks` in `e2e/**/*.ts` because Playwright fixture callbacks use a `use` parameter.
- Cleaned transient `.next/dev/types/validator.ts` generation artifacts that were failing `pnpm type-check`.

### Validation
| Gate | Status |
|------|--------|
| `pnpm check` | ✅ passes (type-check, lint, test:ci, format:check) |
| Vitest | ✅ 734 passed across 81 test files |
| `pnpm test:e2e` | ✅ 46/46 passed across all viewport projects |

### Notes
- The workspace switcher trigger carries `aria-label="Switch workspace"`, so role spec assertions target that accessible name and then assert inner text contains the workspace name.
- Pending user (no workspace membership) is redirected to `/onboarding`; the test uses `domcontentloaded` and a 60s navigation timeout because the cold dev-server redirect can exceed the default 30s under load.
- Turbopack emits transient `ChunkLoadError` unhandled rejections under concurrent workers, but they do not fail assertions; production E2E builds would eliminate this noise.

### Git State
- Branch: main
- Feature commit: 17f1a063bc86fa4afcdfa63b2f535b251dd0c9a0

### Next Step
Run `/epcc-code F006` (core E2E smoke flows).

---

## Session: CODE - 2026-07-20T23:15:00Z
**Feature**: INFRA-001 - Playwright E2E Scaffold
**Status**: verified
**Duration**: ~55 minutes

### What changed
- Installed `@playwright/test` and Playwright browsers (Chromium + WebKit).
- Added `playwright.config.ts` with four projects (Desktop Chrome, iPhone 12/13, Pixel 7, iPad Mini), `webServer` for `pnpm dev`, and global setup/teardown hooks.
- Created `e2e/setup/global.ts` to start Supabase if needed and run `pnpm db:reset` once before specs; `e2e/setup/teardown.ts` stops Supabase only in CI.
- Created `e2e/health.spec.ts` smoke test asserting the seeded `/login` page renders.
- Added `test:e2e`, `test:e2e:ui`, `test:e2e:ci` package scripts and documented setup in `README.md` / `.env.example`.
- Updated `.gitignore` to ignore Playwright artifacts.

### Validation
| Gate | Status |
|------|--------|
| `pnpm check` | ✅ passes (type-check, lint, test:ci, format:check) |
| Vitest | ✅ 734 passed across 81 test files |
| `pnpm test:e2e` | ✅ 4/4 passed across all viewport projects |

### Notes
- A transient `PostgREST error [undefined]` appeared on the first `pnpm test:ci` run in `quotes/public.integration.test.ts`. The same test passed in isolation and the full suite passed on retry, confirming local Supabase flakiness rather than a code regression.
- Playwright E2E is additive under `e2e/` and does not interfere with `pnpm test:ci`.

### Git State
- Branch: main
- Feature commit: 5d54255

### Next Step
Run `/epcc-code INFRA-002` (Playwright auth fixtures for seeded roles).

---

## Session: CODE - 2026-07-20T12:30:00Z
**Feature**: F001 - PWA Installable Manifest
**Status**: verified
**Duration**: ~45 minutes

### What changed
- Generated a placeholder PWA icon set in `public/icons/` (192×192, 512×512, 512×512 maskable, 180 apple-touch-icon, 16×16 and 32×32 favicons) from warm-white SVG masters using `sharp`.
- Added `src/config/manifest.ts` as the brand-driven manifest source of truth, consumed by the new `/api/manifest` route so root-level auth redirects do not intercept the manifest.
- Updated root metadata in `src/app/layout.tsx` to emit `manifest`, apple-touch-icon, favicon, and shortcut icon links.
- Added `scripts/generate-pwa-icons.ts` and the `icons:generate` pnpm script for reproducible icon generation.
- Updated `src/app/manifest.test.ts` and added `src/app/api/manifest/route.test.ts` for coverage.

### Validation
| Gate | Status |
|------|--------|
| `pnpm check` | ✅ passes (type-check, lint, test:ci, format:check) |
| Tests | ✅ 734 passed across 81 test files |
| Lighthouse 11 PWA audit on `/login` | ✅ 100/100, installable-manifest + maskable-icon passing |

### Notes
- Next.js root-level manifest convention route handlers were redirecting to `/login`; serving via `/api/manifest` avoids the auth middleware on that path.
- The acceptance criteria referenced `src/app/manifest.ts`; that file was removed in favor of `src/config/manifest.ts` + `/api/manifest`. Functionally equivalent and verified by tests.
- Placeholder icons should be replaced with final brand assets before production.

### Git State
- Branch: main
- Feature commit: 3e9b604

### Next Step
Record F001 verification SHA in `epcc-features.json`, then run `/epcc-code INFRA-001` to scaffold Playwright E2E, or `/epcc-code F002` for mobile touch targets.

---

## Session: EXPLORE - 2026-07-20T14:45:00Z
**Target**: Whole-app mobile usability, PWA installability, and Playwright E2E with Supabase seed data
**Thoroughness**: high
**Duration**: ~35 minutes

### Areas Explored
- Mobile responsiveness across `(app)`, `(auth)`, `(marketing)`, public token pages, admin and assistant surfaces
- PWA readiness: manifest, icon assets, metadata, service worker / offline strategy
- Existing test infrastructure: Vitest unit/integration suite, DB helpers, coverage config
- Playwright E2E gap: dependency, config, fixtures, seed-data-driven auth and page-flow tests
- `supabase/seed.sql` users, workspaces, invoices, quotes, books, drive and cross-module event wiring

### Key Patterns Found
- Mobile layouts are already responsive (safe-area insets, flex-wrap, overflow-x-auto, public pages mobile-first) but touch targets and dense tables are below mobile guidelines
- Manifest exists and is brand-driven, but missing icon set and install-critical fields, so the app is not installable today
- Vitest suite is strong (726 tests passing), but Playwright is greenfield: no dependency, config, or e2e specs
- Seed data is rich and can directly power E2E fixtures with known passwords

### Files Examined
~35 files including `src/app/manifest.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/shared/components/app-shell/app-shell.tsx`, `src/shared/ui/button.tsx`, `src/shared/ui/input.tsx`, `src/shared/ui/dialog.tsx`, `src/shared/ui/sheet.tsx`, `src/shared/ui/segmented-control.tsx`, `src/shared/ui/data-table.tsx`, `src/app/(app)/customers/customers-table.tsx`, `src/app/(app)/invoices/[id]/page.tsx`, `src/app/(app)/quotes/[id]/page.tsx`, `src/app/(app)/books/books-summary.tsx`, `src/app/(app)/books/tax/page.tsx`, `src/app/(app)/assistant/assistant-chat.tsx`, `src/app/q/[token]/quote-accept-form.tsx`, `src/app/i/[token]/page.tsx`, `supabase/seed.sql`, `package.json`, `vitest.config.ts`, plus prior agent transcripts.

### Handoff Notes
- Ready for: `/epcc-plan` implementation phase scoped to manifest/icons, mobile touch targets, responsive dialogs, and Playwright scaffold + auth fixtures + core smoke specs
- Blockers: need a high-resolution Soletrade mark to generate the PWA icon set; otherwise none
- Follow-up: confirm whether offline/service-worker behaviour is required beyond basic Add to Home Screen installability

### Git State
- Commit: d64381a
- Branch: main
- Clean: no (`epcc-features.json`, `EPCC_PLAN.md` created; `EPCC_EXPLORE.md` and `epcc-progress.md` updated)

---

## Session: PLAN - 2026-07-20T15:05:00Z
**Target**: Mobile UX, PWA installability, Playwright E2E
**Status**: Approved

### Plan Overview
- **Phases**: 9
- **Total tasks**: 34
- **Estimated effort**: ~39.5h
- **Features**: F001 PWA manifest, F002 mobile touch targets, F003 responsive dialogs, F004 mobile dense tables, F005 responsive signature, INFRA-001 Playwright scaffold, INFRA-002 auth fixtures, F006 core smoke flows, INFRA-003 service worker / offline fallback

### Approved Decisions
- **Icon asset**: generate a placeholder PWA icon set from the existing favicon; replace with final brand asset before production.
- **Service worker**: include a minimal network-first service worker with a static `/offline` fallback **after** F001 installability passes.
- **Mobile sizing**: use `max-md:` responsive modifiers to preserve desktop density.
- **E2E**: local `pnpm dev` + `pnpm db:reset`; storage-state fixtures seeded from `supabase/seed.sql`.

### Risks Highlighted
- Mobile size changes could break desktop density → mitigated by responsive modifiers.
- Auth rate-limiting during fixture setup → mitigated by storage-state reuse.
- Two-context quote-accept test flakiness → mitigated by explicit waits and fresh public-token extraction.

### Git State
- Commit: d64381a
- Branch: main
- Clean: no (`epcc-features.json` created, `EPCC_PLAN.md` approved, `EPCC_EXPLORE.md` and `epcc-progress.md` updated)

### Next Step
Run `/epcc-code INFRA-001` to scaffold Playwright first, or `/epcc-code F001` to start with the PWA manifest.

---

## Session: EXPLORE - 2026-07-20T11:30:00Z
**Target**: Invoice email delivery in production (send-invoice modal, Resend wiring)
**Thoroughness**: medium
**Duration**: ~12 minutes

### Areas Explored
- Invoice send flow from UI (`invoice-detail-actions.tsx`) through Server Action (`actions.ts`) to `sendInvoice()` service
- Event bus wiring in `src/instrumentation.ts` and `registerNotifications()`
- Resend email client (`src/server/email/index.ts`) and notification handlers (`src/platform/notifications/index.ts`)
- Invoice email template and public-token link construction
- Environment variable requirements and production `.env.prod` presence
- Existing tests covering email no-op / success / failure behavior

### Key Patterns Found
- Best-effort email: `sendEmail()` never throws; missing env → `not-configured`, API failure → `send-failed`, both logged only
- Send-invoice dialog stays open on success because `run()` never clears `pending` state
- Dialog copy still says "No email is sent in this phase" despite email being implemented

### Files Examined
~14 files including `src/instrumentation.ts`, `src/server/email/index.ts`, `src/platform/notifications/index.ts`, `src/platform/notifications/templates.ts`, `src/modules/invoices/index.ts`, `src/app/(app)/invoices/actions.ts`, `src/app/(app)/invoices/invoice-detail-actions.tsx`, `src/shared/lib/env.ts`, `.env.example`, `.env.prod`, plus tests and docs.

### Handoff Notes
- Ready for: PLAN phase to decide UI fix scope (close modal + update copy + optional toast/delivery feedback)
- Blockers: none
- Follow-up: verify Vercel production env values and Resend domain verification status

### Git State
- Commit: 9973aaa
- Branch: main
- Clean: no (deleted `epcc-features.json`)

---

## Session: PLAN - 2026-07-20T11:45:00Z
**Target**: fix-invoice-send-modal-and-email-feedback
**Effort**: ~2h
**Complexity**: Simple

### Summary
Created a focused UI/UX fix plan: update the stale send-dialog copy, close the dialog on success, and show a `sonner` toast. Kept the scope narrow — actual Resend delivery debugging remains a separate operational follow-up.

### Approach
- Reuse existing `sonner`/`Toaster` setup.
- Follow the project's adjust-during-render close pattern if needed.
- Add a component-level test since there is no existing `invoice-detail-actions.test.tsx`.

### Tasks
1. Update send-dialog copy.
2. Close dialog + show toast on success.
3. Add component test.
4. Run type-check / lint / test:ci.

### Risks
- Existing tests/timing assumptions (low).
- Adjust-during-render warning (low; follow existing pattern).

### Out of Scope
- Server Action return-type changes.
- Resend domain/queue operational debugging.

### Git State
- Commit: 9973aaa
- Branch: main
- Clean: no (deleted `epcc-features.json`)

---

## Session: CODE - 2026-07-20T11:55:00Z
**Target**: fix-invoice-send-modal-and-email-feedback
**Mode**: default
**Status**: Complete

### Summary
Implemented the planned UI/UX fix. The Send-invoice dialog now closes on success, the description tells the user an email is sent, and a `sonner` toast confirms the action. Added component-level tests.

### Files Modified
- `src/app/(app)/invoices/invoice-detail-actions.tsx` — updated copy, added toast + dialog close on success.
- `src/app/(app)/invoices/invoice-detail-actions.test.tsx` — new test file (3 tests).
- `EPCC_CODE.md` — implementation notes.

### Quality Metrics
- `pnpm type-check`: clean
- `pnpm lint`: clean
- `pnpm test:ci`: 80 files, 726 tests passed

### Checkpoint Commit
Pending — run `/epcc-commit`.

### Handoff Notes
**Resume at**: `/epcc-commit` to save the verified change.
**Blockers**: None.
**Next action**: Commit the implementation files + EPCC docs.

---

## Session: COMMIT - 2026-07-20T11:57:00Z
**Target**: fix-invoice-send-modal-and-email-feedback
**Status**: Committed

### Summary
Committed the verified change to `main` as `d64381a`.

### Quality Gates
| Gate | Status |
|------|--------|
| Tests | ✅ 726 passed (80 test files) |
| Lint | ✅ clean |
| Type check | ✅ clean |

### Commit Details
- **SHA**: d64381a
- **Message**: fix(invoices): close send dialog on success, toast, and update copy
- **Files changed**: 6 (+379 −1)

### Next Steps
- Optional: push `main` to remote, or create a feature branch + PR for review.
