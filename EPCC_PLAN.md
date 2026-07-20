# Plan: Mobile UX, PWA Installability & Playwright E2E

**Created**: 2026-07-20 | **Effort**: ~39.5h | **Complexity**: Complex (multi-domain) | **Status**: Approved — ready for /epcc-code

## 1. Objective

**Goal**: Make `soletrade` measurably more usable on mobile phones, installable as a PWA from the browser, and protected by seed-data-driven end-to-end browser tests.

**Why**: Mobile traffic dominates SMB invoicing/bookkeeping workflows; PWA installability improves retention and perceived app-quality; Playwright smoke tests on seeded data prevent regressions in the highest-value user journeys.

**Success criteria**:
1. Lighthouse PWA audit reaches **100 / 100 installable** (manifest + icons + metadata + start_url reachable).
2. Minimum touch-target height on small screens is **≥44 px** across the 15 most-used interactive controls.
3. All modal confirmations on `(app)` flows are reachable without horizontal scrolling on a 390×844 viewport.
4. `pnpm test:e2e` runs a login → dashboard → create-and-send invoice flow on desktop and one mobile device against the seeded database.
5. All existing Vitest tests remain green; no visual regressions on desktop.

---

## 2. Approach

### 2.1 Architectural pattern

All work stays inside the existing Next.js 16 App Router + Tailwind v4 + shadcn/ui architecture. We reuse the existing `Sheet`, `Dialog`, `DataTable`, `button`, and `input` primitives rather than introducing new UI libraries. The PWA layer is additive (manifest + static assets + optional client-only registration). The E2E layer is additive and isolated under `e2e/` so it cannot break the unit/integration `pnpm test:ci` path.

**From `EPCC_EXPLORE.md`**:
- Mobile: build on top of the existing safe-area and card-row patterns.
- PWA: extend the brand-driven `manifest.ts` and add `metadata.icons` in `layout.tsx`; defer service worker.
- E2E: use the six seeded users (`owner@soletrade.test` etc., password `password123`) as fixture identities.

### 2.2 PWA strategy

Keep the implementation **manifest-first**. A complete icon set and well-formed `MetadataRoute.Manifest` is sufficient for Chrome/Edge/Safari “Add to Home Screen” installability on Next.js 16.

Once installability is verified, we add a **minimal custom service worker** registered from a client component that:
- Precaches static assets (`/_next/static/*`, `/fonts/*`, `/icons/*`).
- Uses **network-first** for HTML navigations.
- Serves a static `/offline` fallback on failure.
- Excludes `/api/*`, `/i/*`, `/q/*`, `/invite/*`, Stripe Elements scripts, and cron/webhook endpoints.

We do not use `next-pwa` because it is unmaintained and commonly conflicts with Next.js 15/16 App Router.

### 2.3 Mobile strategy

Use **responsive modifiers** (`max-sm:`, `max-md:`) so desktop remains unchanged. Key changes:
- Increase button/input minimum height below `md`.
- Enforce `text-base` on custom `<select>` elements below `md` to prevent iOS auto-zoom.
- Introduce a `ResponsiveDialog` component that renders `Sheet` below `md` and `Dialog` at `md+`.
- Convert the densest read-only tables into card rows or `overflow-x-auto` wrappers below `md`.
- Resize the quote signature canvas via `ResizeObserver` and `devicePixelRatio`.

### 2.4 E2E strategy

Install `@playwright/test` and create a dedicated Playwright project. Use the local dev server (`pnpm dev`) plus Supabase (`pnpm db:reset`) for the `webServer` setup. Auth fixtures sign in each seeded role once and save storage state so specs run fast and avoid auth rate limits. Core smoke specs focus on the merchant-dominant flows that already have seed data:

- login → dashboard
- create and send an invoice
- accept a quote via public `/q/[token]`
- create a books transaction
- invite a member

### 2.5 Trade-offs

| Decision | Chosen | Rationale | Alternatives considered |
|---|---|---|---|
| Service worker | Add after installability | Provides offline fallback without blocking the PWA quick win; avoids `next-pwa` App Router conflicts | Defer entirely; use `@serwist/next` |
| Icon generation | Generate placeholder from favicon | Unblocks installability immediately; final brand asset can be swapped later | Wait for a high-resolution master mark from a designer |
| Mobile sizing | Responsive modifiers, not global size bump | Preserves desktop density; low regression risk | Bump default `button`/`input` heights globally |
| E2E server target | `pnpm dev` + local Supabase | Fastest iteration; seed data auto-loaded by `db:reset` | Run against production preview or `pnpm build` + `pnpm start` |
| E2E auth | Storage-state fixtures from seeded users | Avoids repeated sign-in throttling; fast specs | Create fresh users per spec (slower, flakier) |

---

## 3. Tasks

### Phase 1: PWA Installability (~5h)

1. **Generate and commit PWA icon set** (2h) — create `public/icons/` with 192×192, 512×512, maskable 512, apple-touch-icon 180, and 32×16 favicon PNGs. Add a script or Figma/export note explaining how to regenerate from the master mark.
   - Deps: high-resolution Soletrade mark asset (see Risks).
   - Risk: Medium — asset may not exist; fallback to generated placeholder could look off-brand.

2. **Extend manifest and root metadata** (1.5h) — add `icons`, `scope`, `orientation`, `lang`, `categories`, `shortcuts`, `prefer_related_applications` to `src/app/manifest.ts`; align `theme_color` and `background_color` to light-mode `#f8fafc`; add `metadata.icons` in `src/app/layout.tsx`.
   - Deps: Task 1.
   - Risk: Low.

3. **Update manifest tests** (1h) — assert icon sizes, `scope`, `display`, `theme_color`, and that all icon paths resolve.
   - Deps: Task 2.
   - Risk: Low.

4. **Validate installability** (0.5h) — run `pnpm build`, then `npx lighthouse http://localhost:3000 --preset=desktop --only-categories=pwa` and record score.
   - Deps: Tasks 1–3.
   - Risk: Low.

### Phase 2: Mobile Touch Targets (~6h)

5. **Audit and baseline touch targets** (1.5h) — list the top 15 interactive controls with current computed heights; decide which need bumping.
   - Deps: None.
   - Risk: Low.

6. **Button and input responsive sizing** (2h) — update `src/shared/ui/button.tsx` and `src/shared/ui/input.tsx` to use `max-md:min-h-11` or a new responsive size; update icon-only triggers to `max-md:size-10` where used.
   - Deps: Task 5.
   - Risk: Medium — could shift desktop layouts if not scoped correctly.

7. **Fix custom `<select>` zoom** (1h) — add `text-base max-md:text-base md:text-sm` utility classes to custom selects in settings, books, invoices, drive forms.
   - Deps: None.
   - Risk: Low.

8. **Enlarge assistant controls** (1h) — bump suggested-prompt chips, write-tool toggles, send/stop buttons in `src/app/(app)/assistant/assistant-chat.tsx` to ≥40 px height on small screens.
   - Deps: None.
   - Risk: Low.

9. **Visual regression baseline** (0.5h) — run `pnpm build`, open key pages at 390×844 and 1280×720, capture screenshots for before/after comparison.
   - Deps: Tasks 6–8.
   - Risk: Low.

### Phase 3: Responsive Dialogs (~6h)

10. **Create `ResponsiveDialog` primitive** (2h) — new file `src/shared/components/responsive-dialog.tsx` that uses `Sheet` below `md` and `Dialog` at `md+`, preserving Radix trigger/content/footer APIs.
    - Deps: None.
    - Risk: Low.

11. **Migrate customer-create and quote-accept dialogs** (1.5h) — swap `Dialog` for `ResponsiveDialog` in `customer-create-dialog.tsx` and `quote-accept-form.tsx`.
    - Deps: Task 10.
    - Risk: Low.

12. **Migrate billing and cancellation modals** (1.5h) — update `cancellation-modal.tsx` and `billing-manage-actions.tsx`.
    - Deps: Task 10.
    - Risk: Medium — billing flows have Stripe overlays; test payment modal positioning.

13. **Migrate settings confirmation dialogs** (1h) — update `members-manager.tsx` and `modules-manager.tsx` destructive confirmations.
    - Deps: Task 10.
    - Risk: Low.

### Phase 4: Mobile Dense Tables (~5h)

14. **Invoice/quote line-item card rows** (2h) — render line items as card rows below `md` in `src/app/(app)/invoices/[id]/page.tsx` and `src/app/(app)/quotes/[id]/page.tsx`, or wrap in `overflow-x-auto` if faster.
    - Deps: None.
    - Risk: Medium — totals alignment must stay correct.

15. **Books summary mobile variant** (1.5h) — make `src/app/(app)/books/books-summary.tsx` readable on narrow screens.
    - Deps: None.
    - Risk: Low.

16. **Tax lodged-quarters mobile variant** (1.5h) — make `src/app/(app)/books/tax/page.tsx` lodged-quarters table usable below `md`.
    - Deps: None.
    - Risk: Low.

### Phase 5: Quote Signature Canvas (~2h)

17. **Responsive signature sizing** (2h) — replace fixed `width={480} height={140}` in `quote-accept-form.tsx` with a container ref + `ResizeObserver`, scale by `devicePixelRatio`, and redraw on resize.
    - Deps: None.
    - Risk: Low.

### Phase 6: Playwright E2E Scaffold (~4h)

18. **Install and configure Playwright** (1.5h) — add `@playwright/test`, create `playwright.config.ts` with Desktop Chrome, iPhone 12/13, Pixel 7, iPad Mini projects; configure `webServer`, `testDir: 'e2e'`, reuse `pnpm db:reset` as global setup.
    - Deps: None.
    - Risk: Low.

19. **Add package scripts and CI wiring** (1h) — add `test:e2e`, `test:e2e:ci`, `test:e2e:ui` scripts; update `.env.example` with Playwright/Supabase local notes; document setup in `README.md`.
    - Deps: Task 18.
    - Risk: Low.

20. **Playwright health check spec** (0.5h) — write `e2e/health.spec.ts` that asserts the dev server and seeded login page render.
    - Deps: Task 18.
    - Risk: Low.

21. **Global setup/teardown** (1h) — ensure `pnpm db:reset` runs once before the suite, and that each project cleans its own created data if needed.
    - Deps: Task 18.
    - Risk: Low.

### Phase 7: Playwright Auth Fixtures (~4h)

22. **Create role fixtures** (2h) — `e2e/fixtures/auth.ts` logs in each seeded role (`owner`, `admin`, `accountant`, `employee`, `readonly`) via real form submission, saves storage state under `e2e/.auth/`, and exposes typed page fixtures.
    - Deps: Task 18.
    - Risk: Medium — auth rate-limiting can slow first fixture generation; mitigate by single sign-in per role and reuse.

23. **Role-based access smoke spec** (1.5h) — `e2e/auth/roles.spec.ts` verifies each seeded role lands on dashboard and sees the expected navigation items.
    - Deps: Task 22.
    - Risk: Low.

24. **Fixture utilities** (0.5h) — helpers for switching workspace (WS1 vs WS2) and selecting common seeded entities.
    - Deps: Task 22.
    - Risk: Low.

### Phase 8: Core E2E Smoke Flows (~6h)

25. **Dashboard smoke spec** (1h) — `e2e/dashboard.spec.ts`: owner logs in, dashboard renders KPI cards, no console errors on desktop and iPhone.
    - Deps: Task 22.
    - Risk: Low.

26. **Create-and-send invoice spec** (1.5h) — `e2e/invoices/create-send.spec.ts`: owner creates an invoice, adds a line item, sends it, asserts status change.
    - Deps: Task 22.
    - Risk: Medium — async state updates after Server Actions need explicit awaits.

27. **Accept quote spec** (1.5h) — `e2e/quotes/accept-convert.spec.ts`: owner creates/sends a quote, extracts public token, second context opens `/q/[token]`, accepts it, asserts conversion to draft invoice.
    - Deps: Task 22.
    - Risk: Medium — two-browser-context flow; signature canvas interaction.

28. **Books transaction spec** (1h) — `e2e/books/create-transaction.spec.ts`: owner creates an income transaction, asserts it appears in the list.
    - Deps: Task 22.
    - Risk: Low.

29. **Invite member spec** (1h) — `e2e/settings/invite-member.spec.ts`: owner invites a new member by email, asserts pending invitation row.
    - Deps: Task 22.
    - Risk: Low.

**Estimated effort (Phases 1–8)**: ~34h

---

## 4. Quality Strategy

### 4.1 Tests

- **Vitest**: keep existing 726 tests green. Update `manifest.test.ts` for new PWA fields.
- **Playwright**: new E2E specs run against `pnpm dev` + local Supabase; add at least one mobile project run to CI.
- **Visual QA**: manual screenshot comparison of key pages at 390×844 and 1280×720 before/after mobile changes.
- **Lighthouse PWA**: run `npx lighthouse --only-categories=pwa` on `http://localhost:3000/login` and `/dashboard` after manifest/icons are in place.

### 4.2 Acceptance criteria

| Feature | Criteria |
|---|---|
| PWA manifest | `manifest.webmanifest` includes 192 + 512 + maskable icons; `/dashboard` is installable in Chrome DevTools; `manifest.test.ts` passes |
| Mobile touch targets | All audited controls ≥44 px at 390px viewport; no iOS auto-zoom on select focus |
| Responsive dialogs | Customer-create, quote-accept, billing/cancellation, settings confirmations render as bottom sheets at 390px and centered modals at 1280px |
| Mobile tables | Invoice/quote detail line items, books summary, tax lodged-quarters do not require horizontal pinch-zoom at 390px |
| Responsive signature | Signature canvas fills container width and redraws correctly when viewport changes |
| Playwright scaffold | `pnpm test:e2e` launches and runs at least `health.spec.ts` on desktop + iPhone |
| Auth fixtures | Each seeded role fixture loads in <2s after initial storage-state generation |
| Core smoke flows | 5 core specs pass on desktop; at least dashboard + login pass on mobile |

### 4.3 Regressions to watch

- Desktop button/input heights must not change.
- Quote signature data URI must remain valid after canvas resize.
- Playwright install must not interfere with Vitest (separate test directories and scripts).

---

## 5. Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| High-resolution brand mark asset unavailable | High | Medium | Add a generated placeholder icon set as a stop-gap; document that production should replace with brand asset before shipping |
| Mobile size changes break desktop density | Medium | Medium | Use `max-md:` responsive modifiers; run visual regression on desktop |
| Two-browser-context quote-accept test flaky | Medium | Medium | Use explicit waits for Server Action completion; extract public token from UI instead of relying on seed token |
| Local Supabase + Playwright slow in CI | Medium | Medium | Use `pnpm build` + `pnpm start` for CI E2E; reset DB once per suite |
| iOS Safari manifest quirks (maskable icon safe zone, theme-color) | Low | Medium | Test install prompt in Safari; adjust maskable icon padding if needed |
| Stripe / Resend optional keys block billing E2E | Low | Low | Exclude billing/payment E2E from initial scope |

### 5.1 Assumptions

- A placeholder icon set generated from the existing favicon is acceptable for this phase; production will replace it with a final brand asset.
- E2E tests will run locally first; CI integration is a follow-up.

### 5.2 Out of scope

- Billing/payment checkout flows requiring Stripe keys.
- Real email deliverability assertions (InBucket for magic links only).
- Native mobile app build (Capacitor / React Native / TWA).

---

## 6. Approved Decisions

1. **Icon asset**: Generate a placeholder icon set from the existing favicon/brand mark, with a documented path to replace with final brand assets before production.
2. **Service worker**: Include a minimal network-first service worker with a static `/offline` fallback **after** manifest installability is verified.

---

## 7. Service Worker Follow-up Phase (Phase 9)

**After** F001 passes Lighthouse installability, add a minimal client-registered service worker:

30. **Create `/offline` fallback page** (1h) — static `src/app/offline/page.tsx` explaining the connection is unavailable.
31. **Create minimal service worker** (2h) — precache static assets (`/_next/static/*`, `/fonts/*`, `/icons/*`), network-first for navigations, serve `/offline` fallback on failure; exclude `/api/*`, `/i/*`, `/q/*`, `/invite/*`, and Stripe scripts.
32. **Register service worker from root layout** (1h) — small client component in `src/app/layout.tsx` that calls `navigator.serviceWorker.register('/sw.js')` only in production-like environments.
33. **Add service-worker tests** (1h) — assert registration and `/offline` response in a Playwright spec or via a build-time asset check.
34. **Validate caching exclusions** (0.5h) — verify cron/webhook/API routes are not intercepted.

**Phase 9 effort**: ~5.5h

### Updated total effort
- **Phases 1–8**: ~34h
- **Phase 9 (service worker)**: ~5.5h
- **Grand total**: ~39.5h

**Plan approved** — ready to start `/epcc-code`.
