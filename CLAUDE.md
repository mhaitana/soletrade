@AGENTS.md

# soletrade Workspace - project notes

## What this is
The soletrade Workspace SaaS monolith (repo: `soletrade`): a workspace-first, multi-module
product (Invoices, Books, Drive, Quotes) sharing one auth, billing, customer, file, activity,
and AI foundation. Product branding lives in `src/config/brand.ts`; deployment URLs in
`src/config/urls.ts` (no hard-coded production domain). See `design-system/soletrade/MASTER.md`
for the locked design system and `pages/*.md` for per-surface overrides. See `README.md` for
seed-data login credentials and the full feature/phase inventory.

## Architecture (bulletproof-react)
- `src/platform/*` - reusable platform services. MUST NOT import from `modules/*`.
- `src/modules/*` - business product logic. Cross-module side effects go via the event
  bus in `src/server/events`, never direct imports.
- `src/shared/*` - generic UI + utilities only. No app/module/platform imports.
- `src/server/*` - server-only infra (db, stripe, jobs, events, cache, security).
  Each boundary pulls `import "server-only"`.
- `src/app/*` - Next.js App Router (route groups: `(marketing)`, `(auth)`, `(app)`, `api`).
  App-layer loaders/routes are the **composition root**: they resolve the session +
  workspace, call platform/module services, and never trust a client-supplied
  `workspaceId`. Use `tryWorkspaceContext` (non-redirecting, returns null) in routes
  that must not redirect (e.g. public pages, error paths); the redirecting resolver
  elsewhere.

## Data layer (Supabase JS, not an ORM)
- `src/server/db/client.ts` - `getDataClient()` returns a cached **service-role**
  Supabase client (PostgREST `.from().select()/insert()/update()/delete()`).
  Service-role bypasses RLS; there are **no RLS policies** anywhere - workspace
  scoping is enforced in **code** (every service filters by `workspaceId`
  resolved from the session). RLS hardening is explicitly out of scope.
- PostgREST has no multi-statement transactions → atomic write paths go through
  PL/pgSQL RPC functions called via `supabase.rpc(...)` (see migrations
  `00000000000001_rpc_atomic_writes.sql` + `00000000000002_data_api_grants.sql`).
  Use `unwrapVoid` / row helpers in `src/server/db/helpers.ts`.
- `src/server/db/types.ts` is **generated** - regenerate with `pnpm db:types`
  after any migration. `src/server/db/enums.ts` is a hand-maintained shim for the
  generated enum types. jsonb inserts need `value as unknown as Json`.
- Supabase CLI migrations live in `supabase/migrations/`; `pnpm db:reset` wipes +
  reapplies them and loads `supabase/seed.sql`. Schema change = new migration file,
  then `pnpm db:reset` + `pnpm db:types`.

## Event bus & cross-module wiring
`src/server/events` is an in-process typed bus (`onEvent` / `publish`). Every
published event is persisted to `activity_events` by the persister wired in
`src/instrumentation.ts` (server bootstrap, runs once on startup). All
cross-module side effects are subscribed there - the composition layer - so
modules never import each other:
- `WorkspaceCreated` → `ensureSubscription` (free tier; idempotent, self-heals).
- `InvoiceSent/Overdue/Paid`, `QuoteSent/Accepted/Declined`, refund/void/view
  → notifications (email via Resend + in-app bell) via `registerNotifications`.
- `InvoicePaid` → Books income; `DriveEarningsLogged`/`MileageLogged`/`VehicleExpenseLogged`
  → Books income/expense; `ModuleEnabled(books)` → `replayDriveEventsForBooks` backfill.

When adding a cross-module reaction, subscribe it in `instrumentation.ts`, not in
the module.

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript strict (+ `noUncheckedIndexedAccess`)
- Tailwind v4 (CSS-based config in `src/app/globals.css`) · shadcn/ui (new-york, Radix)
- Supabase JS client (PostgREST + service-role admin client) + Supabase CLI migrations
  · Supabase Auth + Stripe Billing + Resend · Vitest + Testing Library
- AI: Vercel AI SDK v5 (`ai` + `@ai-sdk/anthropic`/`@ai-sdk/openai`); `AI_PROVIDER=mock`
  is the dev default (no key needed).
- Package manager: **pnpm**

## Commands
```bash
pnpm dev               # dev server (http://localhost:3000)
pnpm build             # production build
pnpm type-check        # tsc --noEmit
pnpm lint              # eslint
pnpm test              # vitest (watch)
pnpm test:ci           # vitest run (CI / non-interactive)
pnpm test src/path/to/file.test.ts   # run one test file
pnpm test -t "name"    # run tests matching a name pattern
pnpm format            # prettier --write .
pnpm check             # type-check + lint + test:ci + format:check

pnpm db:start          # start local Supabase (Docker)
pnpm db:reset          # wipe + reapply migrations + load seed.sql
pnpm db:types          # regenerate src/server/db/types.ts from local schema
pnpm db:push           # push migrations to the linked remote (does NOT run seed)

pnpm stripe:setup      # create Stripe Price objects, print env keys
pnpm stripe:listen     # forward Stripe webhooks to localhost:3000/api/stripe/webhooks
pnpm branding:check    # CI guard: no hard-coded brand strings outside src/config
```

Integration tests auto-skip when `DATABASE_URL` is unset, so `pnpm test:ci` stays
green without the local stack. With `pnpm db:start` + `db:reset` running, they
execute for real against local Postgres.

## Cron & public token routes
- `vercel.json` defines 4 daily cron routes under `/api/cron/*`
  (invoice-overdue, quote-expired, credit-expired, module-cancel-finalize). Each is
  guarded by `CRON_SECRET` sent as `Authorization: Bearer <secret>`
  (`src/server/cron-auth.ts` 401s if unset/mismatched).
- Public token pages (no auth, merchant-dominant branding + "Powered by" footer):
  `/i/[token]` (invoice pay via Stripe Elements), `/q/[token]` (quote accept/decline),
  `/invite/[token]` (member invitation accept).

## Environment
`src/shared/lib/env.ts` is the single validated, typed env source (`server-only` -
importing it from client code is blocked). **All secrets are optional** so the app
boots in dev without external services; each module asserts its own required
secrets at its boundary (e.g. AI provider throws at the call site if its key is
unset). Empty strings in `.env` are treated as unset. Stripe has 16 generated
price-id keys (`STRIPE_PRICE_<MODULE>_<STANDALONE|ADDON>_<MONTHLY|ANNUAL>`).

## Next.js version warning
This project uses Next.js 16, which has breaking changes vs older training data.
Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`
(App Router). Heed deprecation notices. Key facts: `params`/`searchParams` are
Promises; `PageProps<'/route'>` and `LayoutProps<'/route'>` are global helpers;
Tailwind v4 uses `@import "tailwindcss"` + `@theme` (no `tailwind.config.js`).

## Rules
- Zod validation on every server boundary (Server Actions, Route Handlers).
- Never trust a client-provided `workspaceId` - resolve from the session.
- All money renders use `tabular-nums` (see `globals.css`).
- No business logic in `src/shared/*`.
- shadcn primitives live in `src/shared/ui` (vendored, not linted).
- Product strings (name, wordmark, URLs) come from `src/config/*` - never hard-code
  them; `pnpm branding:check` enforces it.