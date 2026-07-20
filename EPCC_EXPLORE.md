# Exploration: Mobile Usability, PWA Installability & Playwright E2E

**Date**: 2026-07-20 | **Scope**: Large (whole-app surface audit) | **Status**: ✅ Complete

## Executive Summary

| Domain | Score | Headline |
|---|---|---|
| **Mobile responsiveness** | 6 / 10 | Layouts are mobile-aware (safe-area, flex-wrap, overflow-x-auto, public pages mobile-first), but touch targets, form inputs and several dense tables/dialogs fall below recommended mobile sizes. |
| **PWA installability** | 3 / 10 | Manifest exists and is brand-driven, but the app is **not installable today**: missing icon set, manifest fields, service worker and offline strategy. |
| **E2E / Playwright coverage** | 3 / 10 | Vitest unit/integration suite is strong (726 tests passing), but **Playwright is not installed** and no end-to-end page-flow tests exist. Seed data is excellent and ready to drive E2E fixtures. |

The codebase is a good candidate for a focused mobile/PWA/E2E improvement pass: the design system already uses Tailwind v4, safe-area insets, prefers-reduced-motion and responsive grids, while `supabase/seed.sql` provides six login-able users and two rich demo workspaces that can authenticate Playwright fixtures.

---

## 1. Foundation (What exists)

### 1.1 Tech & design foundation

- **Next.js 16 App Router**, React 19, TypeScript strict, Tailwind v4 (CSS-based config in `src/app/globals.css`).
- **Design system**: `design-system/soletrade/MASTER.md` plus per-page overrides. Branding centralised in `src/config/brand.ts`, URLs in `src/config/urls.ts`.
- **Viewport chrome tinting** already implemented: `src/app/layout.tsx:47-52` switches theme-color between `#f8fafc` (light) and `#0b1220` (dark).
- **Motion/accessibility guard**: `src/app/globals.css` supports `prefers-reduced-motion`.
- **App shell** already handles safe areas: `src/shared/components/app-shell/app-shell.tsx:105-235` uses `pb-[env(safe-area-inset-bottom)]`, `pb-24`, mobile bottom nav and a `Sheet`-based sidebar.

### 1.2 PWA foundation

- **Manifest route** exists: `src/app/manifest.ts:1-20` returns `MetadataRoute.Manifest`.
- Manifest fields are brand-sourced: `name`, `short_name`, `description`, `start_url`, `display`, `background_color`, `theme_color`.
- Manifest has tests: `src/app/manifest.test.ts:10-36` pins name/short-name/description/display.
- OpenGraph + metadata in `src/app/layout.tsx:22-44`; favicon at `src/app/favicon.ico`.
- `display` is already `standalone`, which is the right installable mode.

### 1.3 Mobile responsiveness foundation

- **Public token pages are mobile-first**: `src/app/i/[token]/page.tsx:91-213` and `src/app/q/[token]/quote-accept-form.tsx` use `max-w-md` and generous padding.
- **Auth/onboarding centered narrow forms**: `src/app/(auth)/layout.tsx:3-5`, `src/app/(auth)/login/login-form.tsx:59-102`, `src/app/onboarding/page.tsx:29-57`.
- **Responsive grid breakpoints throughout**: dashboard, books, tax, etc. collapse from `lg`/`sm` multi-column to single column.
- **Data tables wrapped in scroll**: `src/shared/ui/data-table.tsx:46-93` uses `overflow-x-auto`; `src/app/(app)/customers/customers-table.tsx:58-97` uses a card-like mobile variant.
- **iOS auto-zoom partially prevented**: `src/shared/ui/input.tsx:11` uses `text-base md:text-sm`, so inputs do not zoom on focus.

### 1.4 Test foundation

- **Vitest suite**: 80 files, **726 tests passing**, runs in ~25 s via `pnpm test:ci`.
- **Integration tests auto-skip** when `DATABASE_URL` is unset, so CI stays green without Supabase running locally.
- **DB test helpers**: `src/tests/db-helpers.ts` provides `seedUsers`, `cleanupWorkspaces`.
- **Coverage configured** for `src/platform`, `src/modules`, `src/shared/lib` in `vitest.config.ts`.

### 1.5 Seed data (`supabase/seed.sql`)

Loaded automatically by `pnpm db:reset` (`supabase/config.toml` points `sql_paths` at `./seed.sql`).

| Resource | Details |
|---|---|
| **Users (password = `password123`)** | `owner@soletrade.test`, `admin@soletrade.test`, `accountant@soletrade.test`, `employee@soletrade.test`, `readonly@soletrade.test`, `pending@soletrade.test` |
| **Workspaces** | WS1 (AUD/Australia/Sydney, `INV-`/`QUO-` prefixes); WS2 (NZD/Auckland, `BF-`/`QB-` prefixes) |
| **Customers** | WS1: 6 (1 walk-in, 5 emailable); WS2: 2 |
| **Invoices** | WS1: 6 incl. paid, overdue, pending tokens (`inv-seed-pending-token-0001`) |
| **Quotes** | WS1: 6 incl. accepted/declined/draft and public tokens (`quo-seed-0002`, etc.) |
| **Books transactions** | Income/expense rows in both workspaces |
| **Drive data** | Earnings, trips, expenses, vehicles |
| **Cross-module wiring** | `InvoicePaid`, `DriveEarningsLogged`, `MileageLogged`, `VehicleExpenseLogged` → Books |

This seed data can directly power Playwright fixtures: authenticate as each role, pick the pre-seeded workspace, and exercise real module flows.

---

## 2. Patterns (How it's built)

### 2.1 Mobile patterns

- **Composition-root loaders** fan out module services; pages render responsive layouts rather than separate mobile pages.
- **Sheet-based navigation** is already used in the app shell; the same `Sheet` primitive (`src/shared/ui/sheet.tsx`) can be reused for bottom-sheet dialogs on small screens.
- **Card-row mobile variants** already exist for the customers table; the pattern can be extended to other dense data surfaces.
- **Safe-area padding** is localised in the app shell via `env(safe-area-inset-bottom)`.

### 2.2 PWA patterns

- **Brand-driven manifest**: `manifest.ts` imports from `brand`/`urls`, keeping marketing names out of code.
- **Manifest tests** protect against accidental rebrand regressions.
- **No `next-pwa`**: the project currently has no service-worker dependency, which avoids the common Next.js 15/16 App Router conflicts.

### 2.3 Testing patterns

- **Best-effort test gating**: `src/tests/setup.ts` probes the database and skips integration tests if `DATABASE_URL`/TCP is absent.
- **Service-role client** for server tests: `src/server/db/client.ts` returns a cached Supabase service-role client.
- **Event-bus tests**: cross-module reactions are tested through the persisted `activity_events` table.
- **Auth flows**: sign-in/sign-up server actions in `src/app/(auth)/actions.ts` can be hit by Playwright via real browser form submission or direct API calls.

---

## 3. Constraints (What limits decisions)

### 3.1 Next.js 16 App Router constraints

- `manifest.ts` must remain a default export returning `MetadataRoute.Manifest`.
- `params`/`searchParams` are Promises; any per-route metadata logic must follow the current convention.
- App-layer loaders are `force-dynamic` in `(app)/layout.tsx`; service workers should **not** aggressively cache dynamic HTML.
- Tailwind v4 has no `tailwind.config.js`; theming is CSS-variable based. Manifest colors must be hard-coded constants that mirror `globals.css`.

### 3.2 Mobile constraints

- **Touch targets below 44 px are common**:
  - Button default `h-9` (36 px): `src/shared/ui/button.tsx:24`
  - `h-8` (32 px) button variant: `src/shared/ui/button.tsx:26`
  - Icon-only `size-9` (36 px): `src/shared/ui/button.tsx:28`
  - Input `h-9` (36 px): `src/shared/ui/input.tsx:11`
  - `SegmentedControl` `px-3 py-1.5` (~38 px): `src/shared/ui/segmented-control.tsx:55`
  - Search trigger icon-only `w-9`: `src/shared/components/command-palette/search-trigger.tsx:44`
  - Account menu trigger `size-9`: `src/shared/components/app-shell/account-menu.tsx:21`
  - Dialog close `size-9`: `src/shared/ui/dialog.tsx:73`
- **Custom `<select>` elements are `text-sm`**, which iOS may auto-zoom. Examples: `src/app/(app)/settings/general-form.tsx:44-45`, `src/app/(app)/books/books-form.tsx:147,198,217`, `src/app/(app)/invoices/invoices-form.tsx:188-193`.
- **Dense tables without horizontal scroll**: line-items on invoice/quote detail pages, `books-summary.tsx:132-150`, tax lodged-quarters `src/app/(app)/books/tax/page.tsx:151-198`.
- **Dialogs used everywhere**: customer-create, cancellation, billing actions, members/modules confirmations should switch to bottom sheets below `md`.
- **Quote signature canvas fixed resolution**: `src/app/q/[token]/quote-accept-form.tsx:249-259` uses `width={480} height={140}`; needs `ResizeObserver` + `devicePixelRatio` scaling.
- **Assistant controls are small**: write-tool toggles `px-2.5 py-1 text-xs`, suggested prompts `px-3 py-1.5 text-xs`, send/stop buttons ~36 px: `src/app/(app)/assistant/assistant-chat.tsx:194,226,256,306,316`.

### 3.3 PWA constraints

- **Missing icon set** — install blocked until `public/icons/` contains:
  - 192×192 PNG
  - 512×512 PNG
  - 512×512 PNG with safe-zone padding (maskable)
  - 180×180 `apple-touch-icon.png`
  - 32×32 / 16×16 favicon PNGs
- **Manifest missing fields**: `icons`, `scope`, `orientation`, `lang`, `categories`, `shortcuts`, `prefer_related_applications`.
- **Theme mismatch**: `manifest.ts:18` hard-codes `theme_color: "#0b1220"` while `layout.tsx:47-52` adapts to light/dark. Manifest cannot be media-query aware; pick a single light-mode brand color.
- **No service worker / offline strategy**. The recommended first step is **manifest + icons only** (enough for Add to Home Screen); add a custom network-first service worker only if offline shell becomes a real requirement.
- **Public token pages** (`/i/*`, `/q/*`, `/invite/*`) are merchant-dominant and dynamic; any service worker must not intercept them with stale cache.
- **Vercel crons / webhooks**: `vercel.json` defines `/api/cron/*` and `/api/stripe/webhooks`; these must be excluded from service-worker caching.
- **No `next-pwa` dependency** and no `middleware.ts`, so adding a custom worker has no conflicts.
- **`server-only` boundaries**: service-worker code must stay client-only and not import `src/server/*` modules.

### 3.4 E2E / Playwright constraints

- **Playwright is not installed**: `package.json` has no `@playwright/test` script or `test:e2e` entry.
- **Playwright config does not exist**: no `playwright.config.ts`, no `e2e/` directory.
- **Stripe keys are optional**: billing/payment E2E flows need test Stripe keys + `pnpm stripe:listen` forwarding webhooks, or a mocked webhook.
- **Resend is optional**: real email flows require `RESEND_API_KEY` + `EMAIL_FROM`; magic links can be read from local InBucket at `http://127.0.0.1:54324`.
- **Auth rate-limiting**: `src/app/(auth)/actions.ts` may throttle repeated sign-in/sign-up per IP/email; fixtures should authenticate once and reuse storage state.
- **Supabase `enable_confirmations = false`**: password sign-up creates a session immediately in local dev; magic-link still sends via InBucket.
- **Public tokens are dynamic**: seed has fixed tokens, but robust E2E should create a document through the UI and extract its public token.

---

## 4. Reusability (What to leverage)

### 4.1 Components already in the repo that mobile work can reuse

- `src/shared/ui/sheet.tsx` → bottom-sheet dialogs below `md`.
- `src/shared/ui/dialog.tsx` → keep for desktop; wrap in a `ResponsiveDialog` helper.
- `src/shared/ui/data-table.tsx` → add a card-row variant for very narrow screens.
- `src/shared/ui/button.tsx`, `input.tsx` → add mobile size variants (`min-h-11` / `min-h-12`) or responsive classes.
- `src/shared/components/app-shell/app-shell.tsx` → safe-area padding and mobile nav pattern already proven.
- `src/app/(app)/customers/customers-table.tsx` → existing card-row mobile variant to copy.

### 4.2 Assets & config already in the repo that PWA work can reuse

- `src/config/brand.ts` → product name, short name, tagline.
- `src/config/urls.ts` → `urls.app` for `start_url`.
- `src/app/manifest.ts` → extend with `icons`, `scope`, `orientation`, `categories`, `shortcuts`, `lang`.
- `src/app/layout.tsx` → add `metadata.icons` for `apple-touch-icon` and canonical favicons.
- `src/app/manifest.test.ts` → extend with icon assertions.
- `src/app/favicon.ico` → already present; add PNG variants under `public/icons/`.

### 4.3 Testing utilities already in the repo that E2E work can reuse

- `supabase/seed.sql` → six users with known passwords and rich demo data.
- `src/tests/db-helpers.ts` → `seedUsers`, `cleanupWorkspaces` patterns (can be mirrored for E2E DB resets).
- `pnpm db:reset` → wipes + reapplies migrations + loads seed; use as E2E setup hook.
- `pnpm dev` / `pnpm build` + `pnpm start` → local server target.
- `src/app/(auth)/actions.ts` → auth actions can be exercised via browser or direct API.
- `src/app/i/[token]/page.tsx`, `src/app/q/[token]/page.tsx`, `src/app/invite/[token]/page.tsx` → public-token E2E targets.

---

## 5. Handoff (What's next)

### 5.1 Recommended implementation plan

This is a multi-domain improvement; the safest order is:

1. **PWA quick wins** — add icon assets, extend `manifest.ts`, add `metadata.icons` in `layout.tsx`. This alone makes the app installable without touching any runtime logic.
2. **Mobile touch-target pass** — bump button/input minimum heights on small screens, fix custom `<select>` font sizes, enlarge assistant controls.
3. **Dialog → bottom-sheet migration** — create a shared `ResponsiveDialog` wrapper, apply to customer-create, quote accept, cancellation, billing, members/modules confirmation flows.
4. **Dense table mobile variants** — invoice/quote line items, books summary, tax lodged quarters.
5. **Playwright E2E scaffold** — install `@playwright/test`, add `playwright.config.ts` with desktop + mobile projects, auth fixtures seeded from `supabase/seed.sql`.
6. **Core E2E smoke tests** — login, dashboard, create invoice, send invoice, accept quote, create books transaction, invite member.
7. **Optional service worker** — only after the above is stable and if offline shell is explicitly required.

### 5.2 Concrete first stories for `/epcc-plan`

- **pwa-installable-manifest** — generate `public/icons/` set (192, 512, maskable 512, apple-touch-icon 180), extend `manifest.ts` with `icons`, `scope`, `orientation`, `lang`, `categories`, `shortcuts`, `prefer_related_applications: false`, align `theme_color` to light-mode `#f8fafc`, add `metadata.icons` and favicon links in `layout.tsx`, update `manifest.test.ts`.
- **mobile-touch-targets** — introduce responsive `min-h-11` / `min-h-12` classes for buttons and inputs below `md`, fix `<select>` `text-base` sizing, enlarge icon-only triggers to `size-10` minimum, add assistant control sizing.
- **responsive-dialog-wrapper** — create `src/shared/components/responsive-dialog.tsx` that renders `Sheet` below `md` and `Dialog` at `md+`; swap into customer-create, quote-accept, cancellation, billing-manage-actions, members/modules managers.
- **mobile-line-items** — convert invoice/quote detail line-items, books summary and tax lodged-quarters into card rows or `overflow-x-auto` scroll tables below `md`.
- **quote-signature-responsive** — size signature canvas via `ResizeObserver` + `devicePixelRatio` in `quote-accept-form.tsx`.
- **playwright-e2e-scaffold** — install `@playwright/test`, add `playwright.config.ts` with `Desktop Chrome`, `iPhone 12/13`, `Pixel 7`, `iPad Mini` projects, wire `webServer: { command: 'pnpm dev', url: 'http://localhost:3000' }`, add `test:e2e` and `test:e2e:ci` scripts.
- **playwright-auth-fixtures** — create `e2e/fixtures/auth.ts` that signs in each seeded role once, saves storage state, exposes `owner`, `admin`, `accountant`, `employee`, `readonly` page fixtures.
- **e2e-smoke-core-flows** — implement spec files for: `auth/login.spec.ts`, `dashboard.spec.ts`, `invoices/create-send.spec.ts`, `quotes/accept-convert.spec.ts`, `books/create-transaction.spec.ts`, `settings/invite-member.spec.ts`, `public-token-pages.spec.ts`.

### 5.3 Risks and decisions

- **PWA icon source**: need a high-resolution Soletrade mark asset. If only the favicon `.ico` exists, a designer must provide SVG/PNG masters.
- **Service worker scope**: keep scope `/` for simplicity; if public pages should not prompt install, suppress `beforeinstallprompt` with a tiny client component rather than a separate manifest.
- **Mobile size variants vs. global change**: increasing default button height risks layout shifts on desktop; prefer responsive modifiers (`max-sm:min-h-11`) or a dedicated `size="mobile"`.
- **E2E runtime cost**: Playwright with local Supabase + Next.js dev server is the cheapest reliable setup; CI can run against `pnpm build` + `pnpm start` and a fresh `pnpm db:reset`.
- **Test data isolation**: E2E specs should create their own workspace/documents or reuse seed data carefully to avoid cross-spec conflicts. A `db:reset` before the full E2E suite is recommended.

### 5.4 Out of scope for the first pass

- Offline/service-worker runtime caching (can be added later once manifest installability is proven).
- Stripe live payment flows (start with mock webhooks or skip billing E2E).
- Real Resend delivery assertions (use InBucket for magic links; assert UI state, not mailbox).
- Native app wrapper / capacitor / TWA.

### 5.5 Recommended next phase

Run `/epcc-plan` with an initial plan scoped to **pwa-installable-manifest + mobile-touch-targets + playwright-e2e-scaffold + playwright-auth-fixtures + e2e-smoke-core-flows`. This delivers installability, measurably better mobile UX, and a seed-data-powered E2E safety net in one implementation cycle.
