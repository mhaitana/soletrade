# soletrade — Full Review: UI/UX, Security, Performance

**Date:** 2026-07-07
**Scope:** `src/app`, `src/shared`, `src/platform`, `src/modules`, `src/server`
**Method:** Three parallel specialist agents examined actual code (151 tool calls across ~120 files). Findings cite real `file:line` references.

## Executive summary

The codebase is **well-disciplined**. The core multi-tenant invariant — *never trust a client-provided `workspaceId`; resolve from session* — is upheld everywhere. No raw SQL, no hardcoded secrets, no client-trusted money/price/role values. Stripe webhook verification + idempotency, AI write-tool gating, and IDOR defenses on customer/invoice/quote/books lookups are solid. **Zero CRITICAL or HIGH security findings** — only MEDIUM/LOW hardening.

The gaps are concentrated in **UX polish** and **performance infrastructure**:

- **UI**: 1 CRITICAL + 14 HIGH + ~30 MEDIUM. Mostly accessibility wiring (aria linkages, focus rings, headings, landmarks), touch targets below 44px, list tables clipping on mobile, confirmation dialogs closing before the loading state shows, and a few raw hex colors / hardcoded chart colors that break dark mode.
- **Performance**: 3 HIGH + ~8 MEDIUM + ~10 LOW. The big three: (1) **no cache layer at all** — the dashboard re-runs ~8K-row queries on every load; (2) **`activity_events` and `audit_logs` have zero indexes** — every feed/audit query seq-scans; (3) **`publishEvent` awaits all handlers** — "Send invoice" blocks on PDF render + Resend HTTP, so a slow mail provider hangs the user's form submission.
- **Security**: 2 MEDIUM + 6 LOW. The highest-value fix is a one-line proxy change (`/invite` not in `PUBLIC_PREFIXES` breaks the unauthenticated invite flow) and adding the `secure` flag to cookies.

---

## Priority order — fix these first

These are the highest-impact, lowest-effort changes, ordered by value.

### 🔴 P0 — do now (small changes, large impact)

| # | Area | File:line | Change |
|---|------|-----------|--------|
| 1 | Perf | `src/server/db/schema/activity.ts:10` | Add index `(workspaceId, createdAt DESC, id DESC)` + optional `(workspaceId, entityType, entityId, createdAt DESC)`. New migration. Every feed/dashboard/timeline query seq-scans today. |
| 2 | Perf | `src/server/db/schema/audit.ts:9` | Add index `(workspaceId, createdAt DESC, id DESC)`. `/audit` seq-scans. |
| 3 | Perf | `src/server/events/index.ts:95` + `src/platform/notifications/index.ts:47` | Make email/PDF handlers fire-and-forget (`void handler(event)` with try/catch logging, or queue via `src/server/jobs`). "Send invoice/quote" currently blocks on PDF render + Resend HTTP. |
| 4 | UX | 6 list pages: `invoices/page.tsx:134`, `books/page.tsx:184`, `quotes/page.tsx:144`, `drive/page.tsx:260 & 303`, `drive/expenses/page.tsx:101` | `overflow-hidden` → `overflow-x-auto` on table wrappers. Rightmost column (Total/Amount/Status) is clipped and unreachable on 320–375px. |
| 5 | UX | `invoices/invoice-detail-actions.tsx:66`, `books/book-detail-actions.tsx:35`, `quotes/quote-detail-actions.tsx:50` | Remove the leading `setPending(null)` in `run()`. Dialog closes before "Working…" ever renders — no feedback during the server round-trip. Drive already does this correctly. |
| 6 | UX | `src/shared/components/app-shell/app-shell.tsx:190 & 135` | Pass `onNavigate={() => setOpen(false)}` to `NavList` in both mobile Sheets. Tapping a link currently navigates behind the still-open menu. |
| 7 | UX | `src/shared/components/sparkline.tsx:40`, `src/shared/components/bar-chart.tsx:37` | `PRIMARY = "#2563EB"` → `fill="var(--chart-2)"` / `stroke="var(--chart-2)"`. Hardcoded color is too-dark blue in dark mode. |
| 8 | UX | `src/app/(app)/billing/page.tsx:31, 187` | `text-[#059669]` → `text-success` (raw hex breaks dark mode; violates the semantic-token project rule). |
| 9 | UX | `src/app/(auth)/signup/signup-form.tsx:56-65` | Gate the `http://127.0.0.1:54324` Inbucket link behind `NODE_ENV === "development"`. Dead link in production. |
| 10 | Sec | `src/proxy.ts:17` | Add `"/invite/"` to `PUBLIC_PREFIXES`. Unauthenticated first-time invitees get bounced to `/login` instead of seeing the invite page. |
| 11 | UX | `src/app/q/[token]/quote-accept-form.tsx:276` + `page.tsx:127` | Add `id="terms"` to the T&amp;C `<details>`. The "Terms & Conditions" anchor link currently does nothing. |
| 12 | UX | `src/app/(app)/settings/members/members-manager.tsx:208` + `src/app/(app)/files/files-table.tsx:90` | Add confirmation dialogs to "Remove member" and "Delete file" (immediate destructive actions today). |
| 13 | Sec | `src/platform/workspaces/index.ts:190-198` | Add `secure: env.NODE_ENV === "production"` to the active-workspace cookie; ensure Supabase session cookies include it. |
| 14 | UX | `src/app/layout.tsx:19` | Add `export const viewport: Viewport = { themeColor: [...] }` so mobile browsers tint the address bar. |
| 15 | UX | Auth/onboarding forms (`login-form.tsx:71`, `signup-form.tsx:100`, `create-workspace-form.tsx:43`, `invite-accept-form.tsx:34`) | Give each error `<p>` an `id` and add `aria-describedby` on the input. Per-field errors are silent to screen readers today. |

### 🟠 P1 — soon (medium effort, real impact)

| # | Area | File:line | Change |
|---|------|-----------|--------|
| 16 | Perf | `src/server/cache/` (empty) | Build the cache layer: short-TTL `unstable_cache` + `revalidateTag` on `loadDashboardPage`, `summarizeTransactions`, `summarizeDrive`, `listActivity`. Dashboard re-runs 5–9 queries / ~8K rows on every load. |
| 17 | Perf | `src/app/(app)/books/actions.ts:210` + `drive/actions.ts:316` | Replace 2000-row fetch + JS aggregation with DB-side `SUM/GROUP BY` (+ date-bucketed monthly). Wire transfer drops from ~2000 rows to ~10. |
| 18 | Perf | `src/modules/invoices/index.ts:394` (and quotes/customers siblings) | Add keyset cursor pagination + "Load more" UI to module list pages. A workspace with >100 invoices can never see past the first 100 — silently truncated. Platform lists (activity/audit/files/notifications) already paginate correctly; module lists don't. |
| 19 | Perf | `src/app/api/assistant/route.ts:90` + `src/platform/ai/stream.ts:47` | Pass `abortSignal: request.signal` to `streamText`. Client disconnect doesn't cancel the upstream model — wasted tokens/compute. |
| 20 | UX | `src/shared/ui/button.tsx:25`, `input.tsx` | Default `h-9` (36px) → `h-11` (44px) for touch surfaces; icon buttons `size-9` → `size-10`. Every primary submit button is below the 44px minimum. |
| 21 | UX | `src/shared/ui/dialog.tsx:70`, `sheet.tsx:77` | Give `DialogPrimitive.Close`/`SheetPrimitive.Close` `size-9` or `p-2 rounded-md`. The X icon is `size-4` (16px) — far below touch minimum. |
| 22 | UX | `src/shared/ui/command.tsx:73` | Add `focus-visible:ring-2 focus-visible:ring-ring/50` to `CommandInput`. Keyboard users can't see focus. |
| 23 | UX | `src/shared/components/app-shell/workspace-switcher.tsx:56` | Surface workspace switching inside the mobile Sheet. Mobile users can't switch workspaces today. |
| 24 | UX | `src/app/i/[token]/page.tsx:74`, `src/app/q/[token]/page.tsx:63` | Promote the invoice/quote number to a visually-hidden `<h1>`. Public pages have no document outline. |
| 25 | UX | `src/app/error.tsx:31`, `not-found.tsx:17` | Add `focus-visible:` styles to the "Try again" / "Go home" buttons. |
| 26 | UX | `src/app/q/[token]/quote-accept-form.tsx:193` | Gate `onOpenChange` close while `isPending`. Overlay/Escape click discards entered name/signature mid-submit. |
| 27 | UX | Books/drive/tax/drive-summary positive-money colors | Add `dark:text-emerald-500` variants (or a `text-success`/`text-income` token). Currently `text-emerald-600` with no dark variant — loses contrast in dark mode. |
| 28 | UX | `src/shared/ui/sonner.tsx:17` | Enable `richColors` on the toaster. Error toasts render with the same surface as success; only the icon differs. |
| 29 | Sec | `src/app/invite/[token]/actions.ts:25` | Add `rateLimit("invite:" + ip, { max: 10, windowMs: 60_000 })` matching the sibling `/i/` and `/q/` actions. |
| 30 | Sec | `src/app/(app)/actions/notifications.ts:69` + the L2 cluster (PDF routes, loaders, assistant actions) | Add Zod schemas to all server boundaries for clean 400s and consistency with the project's stated convention. IDOR-safe via scoping today, but inconsistent. |

### 🟡 P2 — backlog (lower impact)

UX: CardTitle renders `<div>` not a heading (`card.tsx:31`); error boundaries lack `role="alert"`; no `<main>` landmark on auth/public surfaces; command-palette selected-item contrast low; notification badge not announced to SR; hover-only conversation-delete invisible on touch; no password visibility toggle; no required-field asterisks; no focus management after server-action errors; payment-setup failure no `role="alert"`/retry; misleading ListPageSkeleton on form/detail sub-routes; no `loading.tsx` at `(app)` root or notifications/audit/billing; role-change `<select>` no confirm for high-impact transitions; "Lodge this quarter" no confirm; `disabled:pointer-events-none` suppresses `cursor-not-allowed`; `⌘K` kbd hint Mac-only; raw `text-rose-600`/`border-amber-500` instead of semantic tokens; arbitrary `text-[11px]` sizes; assistant h1/h2 hierarchy inverted; customer links on detail pages go to list not `/customers/[id]`; no back/breadcrumb on detail pages.

Perf: `getInvoice` 2-query sequential waterfall (`invoices/index.ts:428`) — `Promise.all` or single joined query; `convertQuoteToInvoice` re-reads invoice just for the number (`quotes/actions.ts:258`) — have `createInvoice` return it; `module-cancel-finalize` sequential Stripe call per row (`billing/modules.ts:321`) — parallelize; `credit-expired` N+1 idempotency pre-check (`billing/credits.ts:376`) — batch into one `IN (...)` query; `invoice-overdue`/`quote-expired` sequential publish+audit per row; CSV exports silently truncate at 2000 rows (`books/export/route.ts:68`) — stream or surface a truncation indicator; `buildNav` not memoized (`app-shell.tsx:167`); `router.refresh()` on every assistant turn (`assistant-chat.tsx:104`); `postgres({ max: 10 })` has no `idle_timeout`/`connect_timeout` (`db/index.ts:10`); `next.config.ts` empty — no `headers()`/`optimizePackageImports`; `driver_vehicle_expenses.notes` trigram index missing (migration 0017); `customers` ORDER BY + soft-delete filter unbacked; `workspace_invitations.workspaceId` unindexed.

Sec: Quote-accept stores client-provided name/email without verification (`q/[token]/actions.ts:18`) — low risk given 122-bit token; `getWorkspaceOverview` AI tool discloses installed-module list to any role (`assistant/tools.ts:145`); upload-url route accepts client `entityId` without workspace-ownership check (`api/files/upload-url/route.ts:24`) — file record is workspace-scoped so impact is minimal, but cross-workspace reference allowed into metadata; `accepterEmail` not validated as email (`q/[token]/actions.ts:21`).

---

## Detailed findings

### Security

**Overall: solid. No CRITICAL/HIGH.** Verified-solid areas: Stripe webhook signature verification + idempotency (`webhooks.ts`, `handlers.ts:38-46`); Stripe amount/price resolved server-side (no client-trusted values); AI write-tools fail-closed on `writeEnabled && manage:R && hasModule` with `authorizeOrAudit` re-check inside each `execute`; AI conversation IDOR (every query filters `workspaceId AND userId AND conversationId`); customer-id IDOR via `assertCustomerInWorkspace` in invoices/quotes/books; member owner/self-change/last-admin guards; receipt extraction workspace-scoped via `getFile(workspaceId, fileId)`; public invoice/quote/invite pages with `robots: noindex` + rate limits on `/i/` and `/q/`; cron routes 401 on bad secret + constant-time compare; `server-only` on all server/platform logic; no raw SQL; no hardcoded secrets; open-redirect guard on `next` param.

| # | Sev | Category | File:line | Issue & recommendation |
|---|-----|----------|-----------|-----------------------|
| M1 | MEDIUM | Cookies | `src/platform/workspaces/index.ts:190-198` | Active-workspace cookie has `httpOnly` + `sameSite: "lax"` but **no `secure`**. Supabase session cookies likewise. Add `secure: env.NODE_ENV === "production"`. |
| M2 | MEDIUM | Auth/routing | `src/proxy.ts:17` | `PUBLIC_PREFIXES` omits `/invite/`. Unauthenticated first-time invitees bounce to `/login` instead of seeing the invite page (which is designed to handle signed-out users). Add `"/invite/"`. |
| L1 | LOW | Input validation | `src/app/(app)/actions/notifications.ts:69` | `markReadAction(notificationId: string)` has no Zod on a **mutating** action. IDOR-safe (`markRead` filters `workspaceId AND userId AND id`), but a malformed UUID throws at DB layer. Add `z.string().uuid()`. |
| L2 | LOW | Input validation | quotes/actions.ts:329,353; PDF routes; assistant/actions.ts:29; notifications/audit/activity/files loaders | Read-only loaders/params lack Zod. IDOR-safe via scoping; limits capped internally. Add schemas for clean 400s + convention consistency. |
| L3 | LOW | Rate limiting | `src/app/invite/[token]/actions.ts:25` | No `rateLimit` on invite-accept (siblings `/i/` and `/q/` have one). Token is 122-bit so brute-force infeasible; add for consistency. |
| L4 | LOW | Public pages | `src/app/q/[token]/actions.ts:18-23` | Quote-accept stores client-provided `accepterName`/`accepterEmail` without verifying against the quote's customer email. Low risk given unguessable token; consider verifying if customer email on file. |
| L5 | LOW | AI tools | `src/app/(app)/assistant/tools.ts:145-150` | `getWorkspaceOverview` always includes `installedModules` — a `readonly` member with no `view:R` learns installed modules. Gate behind any `view:R` grant or return only a count. |
| L6 | LOW | File handling | `src/app/api/files/upload-url/route.ts:24-27` | Client `entityId` not checked against workspace ownership. File record is workspace-scoped (can't escape), but `entityId` could reference an entity in another workspace, creating misleading metadata. Verify ownership or drop `entityId`. |

### Performance

**Verified-solid:** Server Components for all list pages (zero client JS); keyset cursor pagination on platform lists (activity/audit/files/notifications); trigram-indexed search (migration 0017); `@react-pdf/renderer` confined to `src/server/pdf` (`server-only`); Stripe Elements only on the public payment route; `cmdk` in a single client island; `Sparkline`/`BarChart` are pure inline-SVG server components (no chart lib); all `.map()` renders have `key`; command palette has 150ms debounce + AbortController; `useChat` transport lazy-init'd once; no `100vh`/`h-screen` anywhere.

| # | Sev | Category | File | Issue & recommendation |
|---|-----|----------|------|-----------------------|
| P1 | HIGH | Caching | `src/server/cache/` (empty) | No cache layer at all. Dashboard re-runs ~8K-row queries every load. Build short-TTL `unstable_cache` + `revalidateTag` on dashboard/books/drive summaries + activity. |
| P2 | HIGH | Indexes | `src/server/db/schema/activity.ts:10` | `activity_events` has zero indexes. Every feed/dashboard/timeline query seq-scans on a monotonically-growing table. Add `(workspaceId, createdAt DESC, id DESC)` + `(workspaceId, entityType, entityId, createdAt DESC)`. |
| P3 | HIGH | Blocking I/O | `src/server/events/index.ts:95` + `notifications/index.ts:47` | `publishEvent` awaits all handlers. `sendInvoice`/`sendQuote` block on PDF render (CPU) + Resend HTTP (network). Make handlers fire-and-forget or queue via `src/server/jobs`. |
| P4 | MED-HIGH | Data loading | `books/actions.ts:210` + `drive/actions.ts:316` | 2000-row fetch + JS aggregation (Books even fetches 100 for list **and** 2000 for summary). Add DB-side `SUM/GROUP BY`. |
| P5 | MEDIUM | Pagination | `invoices/index.ts:394` + quotes/customers | No pagination; silently cap at 100. Add keyset cursor + "Load more" mirroring the activity page. |
| P6 | MEDIUM | Indexes | `src/server/db/schema/audit.ts:9` | `audit_logs` zero indexes. `/audit` seq-scans. Add `(workspaceId, createdAt DESC, id DESC)`. |
| P7 | MEDIUM | SSE | `src/app/api/assistant/route.ts:90` + `ai/stream.ts:47` | No `abortSignal` — client disconnect doesn't cancel the model. Pass `request.signal` to `streamText`. |
| P8 | MEDIUM | Cron | `billing/modules.ts:321` | Sequential Stripe API call per row in cancel-finalize (100 rows = 20–50s). Parallelize independent per-workspace calls. |
| P9 | MEDIUM | Cron | `billing/credits.ts:376` | N+1 idempotency pre-check per row. Batch into one `IN (...)` query + in-memory `Set`. |
| P10 | MEDIUM | Caching | ~20 files with `force-dynamic` | Symptom of P1. With a cache layer, period-based pages could become ISR. |
| P11 | MEDIUM | Data loading | `invoices/index.ts:428` | `getInvoice` 2-query sequential waterfall for line items. `Promise.all` or single joined query. (`getQuote` already parallelizes.) |
| P12 | LOW | Indexes | `migrations/0017` | `driver_vehicle_expenses.notes` trigram index missing (the one ILIKE column without backing). Add `gin ("notes" gin_trgm_ops)`. |
| P13 | LOW | Indexes | `customers/index.ts:88` | ORDER BY `createdAt` + soft-delete filter unbacked. Partial index `(workspace_id, created_at DESC) WHERE deleted_at IS NULL`. |
| P14 | LOW | Cron | `invoices/index.ts:866`, `quotes/index.ts:1102` | Sequential `publishEvent`+`writeAudit` per row. `Promise.all` (independent). No row limit on the bulk UPDATE. |
| P15 | LOW | Export | `books/export/route.ts:68` | CSV built in-memory; silently truncates at 2000 rows. Stream or surface a truncation indicator. |
| P16 | LOW | React | `app-shell.tsx:167` | `buildNav` recomputed every render. `useMemo([installedModules])`. |
| P17 | LOW | React | `assistant-chat.tsx:104` | `router.refresh()` on every assistant turn. Scope the refresh or only refresh the sidebar. |
| P18 | LOW | Data loading | `quotes/actions.ts:258` | `convertQuoteToInvoice` re-reads invoice just for the number. Have `createInvoice` return it. |
| P19 | LOW | Config | `next.config.ts` (empty) | No `headers()` (e.g. `Cache-Control` on `/api/*`, SWR on static) or `optimizePackageImports` for `lucide-react`. |
| P20 | LOW | DB pool | `src/server/db/index.ts:10` | `postgres({ max: 10 })` has no `idle_timeout`/`connect_timeout`/`max_lifetime`. Add for cold-start churn. |

### UI / UX

**Verified-solid:** `tabular-nums` on money (105 usages); `prefers-reduced-motion` handled globally and correctly (durations → 0.01ms so listeners still fire); `min-h-dvh` everywhere; consistent actionable empty states on every list surface; confirmation dialogs with focus trap/escape/destructive variant on invoices/books/quotes/drive deletes; `buildNav` memoization in command palette; AbortController cleanup on search.

| # | Sev | Category | File:line | Issue & recommendation |
|---|-----|----------|-----------|-----------------------|
| U1 | CRITICAL | Charts | `sparkline.tsx:40`, `bar-chart.tsx:37` | `PRIMARY = "#2563EB"` hardcoded — too-dark blue in dark mode. Use `var(--chart-2)`. |
| U2 | HIGH | A11y | auth/onboarding forms (4 files) | Field errors set `aria-invalid` but error `<p>` has no `id` + no `aria-describedby` link. Per-field errors silent to SR. Wire them. |
| U3 | HIGH | A11y | `i/[token]/page.tsx:74`, `q/[token]/page.tsx:63` | No `<h1>` on public invoice/quote pages. Promote number (or visually-hidden "Invoice {number}") to `<h1>`. |
| U4 | HIGH | A11y | `q/[token]/quote-accept-form.tsx:276` | `#terms` anchor target missing — `<details>` on `page.tsx:127` has no `id="terms"`. Add it. |
| U5 | HIGH | A11y | `command.tsx:73` | `CommandInput` has no visible focus indicator (`outline-hidden`, no `focus-visible:ring`). Add ring. |
| U6 | HIGH | A11y | `error.tsx:31`, `not-found.tsx:17` | "Try again"/"Go home" have no `focus-visible:` styles. Use `<Button variant="link">` or explicit ring. |
| U7 | HIGH | Touch | `button.tsx:25`, `input.tsx` | Default `h-9` (36px) below 44px minimum. Bump to `h-11`; icon buttons to `size-10`. |
| U8 | HIGH | Touch | `dialog.tsx:70`, `sheet.tsx:77` | Dialog/Sheet close button hit area ~16px (`size-4` icon, no padding). Add `size-9` / `p-2 rounded-md`. |
| U9 | HIGH | Touch | `login-form.tsx:99`, `signup-form.tsx:144` | Link-style toggle buttons `h-auto p-0` collapse to ~20px. Keep `min-h-9` or add vertical padding. |
| U10 | HIGH | Touch | `app-shell.tsx:190 & 135` | Mobile menus don't auto-close on navigation — `NavList`'s `onNavigate` prop never supplied. Pass `onNavigate={() => setOpen(false)}`. |
| U11 | HIGH | Touch/nav | `workspace-switcher.tsx:56` | No workspace switcher on mobile (`hidden … md:flex`, not in either Sheet). Surface it inside the mobile menu. |
| U12 | HIGH | Feedback | `invoice-detail-actions.tsx:66`, `book-detail-actions.tsx:35`, `quote-detail-actions.tsx:50` | `run()` leads with `setPending(null)` — dialog closes before "Working…" renders. Remove it; close after success/error. |
| U13 | HIGH | Layout | 6 list tables | `overflow-hidden` clips the rightmost column on mobile. → `overflow-x-auto`. |
| U14 | HIGH | Layout | `layout.tsx:19` | No `viewport` export → no `themeColor`. Add it for mobile address-bar tinting. |
| U15 | HIGH | Color | `billing/page.tsx:31, 187` | Raw hex `#059669` breaks dark mode + violates semantic-token rule. Use `text-success`. |
| U16 | HIGH | Destructive | `members-manager.tsx:208`, `files-table.tsx:90` | "Remove member"/"Delete file" have no confirmation dialog. Add one. |
| U17 | HIGH | Forms | `signup-form.tsx:56-65` | Hardcoded `http://127.0.0.1:54324` Inbucket link shown unconditionally. Gate behind `NODE_ENV === "development"`. |
| U18 | MEDIUM | A11y | `error.tsx:23`, `(app)/error.tsx:27` | Error boundaries lack `role="alert"`/`aria-live`. Add it. |
| U19 | MEDIUM | A11y | `(auth)/layout.tsx:3`, public pages | No `<main>` landmark on auth/public surfaces. Wrap primary content. |
| U20 | MEDIUM | A11y | `card.tsx:31` | `CardTitle` renders `<div>`, not a heading. Loses document outline. Render `<h3>` by default. |
| U21 | MEDIUM | A11y | `command.tsx:150` | Selected command-palette item contrast ~3-4% lightness diff (only keyboard indicator). Darken or add left border. |
| U22 | MEDIUM | A11y | `notification-bell.tsx:62-79` | Badge count not announced (no role on span; button label static); "Mark all read" no focus ring. Update aria-label dynamically; add ring. |
| U23 | MEDIUM | A11y | `notifications-list.tsx:90` | Unread state not accessible (dot `aria-hidden`; only subtle font weight); `bg-destructive` for "unread" is unconventional (red = error). Add `aria-label`; use neutral/brand dot. |
| U24 | MEDIUM | Touch | `input.tsx:11` | `disabled:pointer-events-none` contradicts `disabled:cursor-not-allowed` — no disabled affordance. Drop `pointer-events-none`. |
| U25 | MEDIUM | Touch | `assistant-chat.tsx:172` | Hover-only conversation delete invisible on touch. Always show on `pointer: coarse` or use overflow menu. |
| U26 | MEDIUM | Touch | `drive/page.tsx:123`, `dashboard/page.tsx:137` | Sub-section links & period selector pills <44px. Add padding or use `Button size="sm"`. |
| U27 | MEDIUM | Forms | all auth + customer/settings forms | No password visibility toggle; no required-field asterisks; no focus management after server-action errors. Add toggle, `*` indicators, error-banner focus. |
| U28 | MEDIUM | Forms | `signup-form.tsx:124` | Confirm-password has no `aria-invalid` + no inline error. Mismatch only in top banner. |
| U29 | MEDIUM | Forms | `i/[token]/invoice-payment-form.tsx:63-128` | Payment failure no `role="alert"`/retry; "Processing…" used for both "Stripe loading" and "confirming". Distinct copy + retry. |
| U30 | MEDIUM | Forms | `q/[token]/quote-accept-form.tsx:138,193` | Dialog closes on server error (error renders outside, jarring); `onOpenChange` dismisses mid-submit. Keep open on error; gate close while `isPending`. |
| U31 | MEDIUM | Forms | 7 form files (invoices/books/quotes/drive) | Cancel is a plain `<Link>` — discards unsaved changes with no confirm. Prompt when dirty. |
| U32 | MEDIUM | Forms | `members-manager.tsx:189`, `books/tax/lodge-quarter-button.tsx:26` | Role-change `<select>` no confirm for high-impact transitions; "Lodge this quarter" no confirm. Add dialogs. |
| U33 | MEDIUM | Feedback | `command-palette.tsx:109` | No visible loading state during debounced `/api/search` (static "Navigate" group always has items). Add inline indicator. |
| U34 | MEDIUM | Layout | `(app)/loading.tsx` + notifications/audit/billing | No `loading.tsx` at group root or 3 pages; nested routes show the parent's ListPageSkeleton (layout shift). Add form-skeleton variants. |
| U35 | MEDIUM | Color | books/drive/tax summaries | `text-emerald-600` with no `dark:` variant — loses contrast in dark mode. Add `dark:text-emerald-500` or semantic token. |
| U36 | MEDIUM | Color | `sonner.tsx:17` | Toaster doesn't enable `richColors` — error toasts same surface as success. Enable it. |
| U37 | MEDIUM | Nav | detail pages (`invoices/[id]` etc.) | No back/breadcrumb; customer link goes to `/customers` list not `/customers/[id]`. Add back link; deep-link customers. |
| U38 | LOW | A11y | `globals.css:64,119` | No `color-scheme: light`/`dark` — native form controls render light in dark mode. Add it. |
| U39 | LOW | A11y | `app-shell.tsx:69 & 112` | Duplicate `aria-label="Primary"` on desktop + bottom nav. Give bottom nav a distinct label. |
| U40 | LOW | A11y | `app-shell.tsx:196` | Mobile Sheet omits `SheetDescription` (Radix warning). Add `sr-only` description. |
| U41 | LOW | Touch | `button.tsx` cva | No `cursor-pointer` in base. Native `<button>` defaults to `cursor: default`. Add it. |
| U42 | LOW | Touch | `search-trigger.tsx:48` | `⌘K` kbd hint Mac-only (Ctrl+K on Win/Linux). Detect platform. |
| U43 | LOW | Forms | `login-form.tsx:33` | Magic-link sign-in drops the `next` deep-link param. Forward it. |
| U44 | LOW | Forms | `q/[token]/actions.ts:21-22` | `accepterEmail` not `.email()`-validated; signature 100k-char cap may truncate large PNGs. Add `.email()`; raise cap or client-side size check. |
| U45 | LOW | Color | `assistant-chat.tsx:193,227`, `modules-manager.tsx:221` | Raw `text-rose-600`/`border-amber-500` instead of semantic tokens. Standardize. |
| U46 | LOW | Type | `notifications-list.tsx:105`, `customer-timeline.tsx:80`, `cancellation-modal.tsx:107` | Arbitrary `text-[11px]`/`text-[0.7rem]` bypass the type scale. Use tokenized sizes. |
| U47 | LOW | Type | `assistant-chat.tsx:157,209` | h1/h2 hierarchy inverted (h1 `text-sm font-semibold`, h2 `text-sm font-medium text-muted`). Bump h1. |
| U48 | LOW | Charts | `bar-chart.tsx:99` | X-axis truncates at 7+ellipsis ("Uber Eats" → "Uber Ea…"). Widen, rotate, or per-bar `<title>`. |
| U49 | LOW | Charts | `drive-summary.tsx:113` | "Mileage deduction" detail renders distance twice ("1,234.5 km × 1234 km"); rate is missing. Show `× $rate/km`. |
| U50 | LOW | Charts | `books/tax/page.tsx:82,111,181` | "Net GST owed" color inverted (positive=red=owed; negative=green=refund) — opposite of every other surface. Confusing for color-blind users. Add an icon or use neutral color. |

---

## Suggested fix waves

**Wave A (P0, ~half-day):** DB index migration (#1–2), fire-and-forget event handlers (#3), the six `overflow-x-auto` + three `setPending(null)` + two `onNavigate` one-liners (#4–6), chart/billing color tokens (#7–8), Inbucket gate (#9), proxy `/invite/` (#10), `#terms` id (#11), member/file confirm dialogs (#12), cookie `secure` (#13), viewport themeColor (#14), aria-describedby wiring (#15). All small, mechanical, high-value.

**Wave B (P1, ~2–3 days):** Cache layer (#16), DB-side aggregation (#17), module-list pagination (#18), assistant abortSignal (#19), touch-target sizing pass (#20–21), command input focus ring (#22), mobile workspace switcher (#23), public-page h1 (#24), error-button focus (#25), accept-dialog close gating (#26), dark-mode green variants (#27), sonner richColors (#28), invite rate limit (#29), Zod-on-boundaries pass (#30).

**Wave C (P2, ongoing):** the remaining MEDIUM/LOW UX polish + cron/DB/connection-pool perf items. Tackle alongside feature work.

---

*Review generated by three parallel specialist agents (security, performance, UI/UX) over ~120 files. Findings cite actual `file:line` references — verify each against current code before implementing.*