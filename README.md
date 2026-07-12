# Soletrade Workspace

Soletrade Workspace is a unified business workspace for invoicing, quotes, bookkeeping,
receipts, expenses, mileage, and earnings. One workspace to run your business - a
workspace-first, multi-module product for solo traders, freelancers, and gig operators.
Four launch modules (Invoices, Books, Drive, Quotes) share one foundation: auth,
workspaces, billing, customers, files, activity, AI, permissions, and settings.

> Repository: `soletrade`. Product: **Soletrade Workspace** (© Matt Haitana). Built
> on strict [bulletproof-react](https://github.com/alan2207/bulletproof-react) principles.
> The design system is locked in `design-system/soletrade/`.

## Stack

- **Framework:** Next.js 16 (App Router) · React 19
- **Language:** TypeScript (strict + `noUncheckedIndexedAccess`)
- **Styling:** Tailwind CSS v4 · shadcn/ui (new-york · Radix)
- **Data:** Supabase JS client (PostgREST) · PostgreSQL (Supabase) · Supabase CLI migrations
- **Auth:** Supabase Auth
- **Billing:** Stripe Billing (subscriptions, credit ledger)
- **Email/SMS:** Resend · Twilio (optional)
- **Tests:** Vitest · Testing Library · Playwright (later)
- **Package manager:** pnpm

## Getting started

```bash
pnpm install
pnpm db:start          # start local Supabase (Docker) - first run pulls images
pnpm db:reset          # apply all Supabase migrations to the local Postgres
pnpm dev               # http://localhost:3000
```

This drops a `.env.local` with the local Supabase connection values (see
`supabase status` to refresh them after a `db:stop`/`db:start`). The app boots
with defaults even without secrets - modules assert their own required secrets
at their boundaries.

### Local database & integration tests

The project ships a local Supabase stack for development and for the
`DATABASE_URL`-gated integration tests (customers, activity). Workflow:

```bash
pnpm db:start          # supabase start - Postgres + Auth + Studio on 54321–54323
pnpm db:reset          # wipe + recreate local DB, then re-apply supabase/migrations
pnpm db:types          # regenerate src/server/db/types.ts from the local schema
pnpm test:ci           # runs unit + integration tests against the local DB
pnpm db:stop           # stop the local stack (data persists in Docker volumes)
```

Integration tests auto-skip when `DATABASE_URL` is unset, so `pnpm test:ci`
stays green in environments without a DB (e.g. CI smoke checks). With the local
stack running, they execute for real.

### Seed data

`pnpm db:reset` also loads `supabase/seed.sql` (wired via `[db.seed]` in
`supabase/config.toml`), so a freshly-reset local DB is populated and browseable
in the app. It creates 6 login-able users (password `password123` for all) plus
full demo data across both workspaces - every module, every lifecycle status
(invoices ×6 statuses, quotes ×7), all enum values, cross-module source links
(InvoicePaid / Drive→Books income / mileage / vehicle-expense), the credit
ledger (all 6 entry types), tax periods, activity/audit/notifications, an AI
conversation, files, and receipt extractions.

Dev login credentials:

| Email                  | Role       | Workspace              |
| ---------------------- | ---------- | ---------------------- |
| `owner@soletrade.test`    | owner      | Soletrade Demo Co + Bellflower |
| `admin@soletrade.test`    | admin      | Soletrade Demo Co        |
| `accountant@soletrade.test` | accountant | Soletrade Demo Co      |
| `employee@soletrade.test` | employee   | Soletrade Demo Co        |
| `readonly@soletrade.test` | readonly   | Soletrade Demo Co        |
| `pending@soletrade.test`  | - (pending invitation) | Soletrade Demo Co |

Seed is **local-dev only** - `supabase db push` does not run `seed.sql` on the
linked remote, so these test users never reach production.

## Scripts

| Script              | Purpose                                  |
| ------------------- | ---------------------------------------- |
| `pnpm dev`          | Start dev server                         |
| `pnpm build`        | Production build                          |
| `pnpm type-check`   | `tsc --noEmit`                           |
| `pnpm lint`         | ESLint                                    |
| `pnpm test`         | Vitest (watch)                            |
| `pnpm test:ci`      | Vitest run (CI)                           |
| `pnpm format`       | Prettier write                            |
| `pnpm check`        | type-check + lint + tests + format:check |
| `pnpm db:start`     | Start local Supabase stack                |
| `pnpm db:stop`      | Stop local Supabase stack                 |
| `pnpm db:status`    | Show local Supabase URLs + keys           |
| `pnpm db:reset`     | Wipe + recreate local DB, re-apply migrations |
| `pnpm db:push`      | Push local schema/migrations to the linked remote |
| `pnpm db:types`     | Regenerate `src/server/db/types.ts` from the local schema |

## Project structure

```
src/
├── app/                 # Next.js App Router (route groups: marketing, auth, app, api)
├── platform/            # Reusable platform services (no module imports)
├── modules/             # Business product logic (invoices, books, drive, quotes)
├── shared/              # Generic UI + utilities (no business logic)
│   ├── ui/              # shadcn primitives (vendored)
│   ├── components/      # Shared app components (app-shell, theme, logo)
│   ├── hooks/  lib/  utils/  constants/  types/
├── server/              # Server-only infra (db, stripe, jobs, events, cache, security)
└── tests/               # Test setup
```

**Boundaries:** `modules → platform → shared`. `platform` never imports `modules`.
`shared` never imports app/module/platform code. Cross-module side effects go through
the event bus in `server/events`, never direct module imports.

## Design system

Generated and persisted by the UI/UX Pro Max skill:

- `design-system/soletrade/MASTER.md` - global source of truth
- `design-system/soletrade/pages/dashboard.md` - app shell + dashboard overrides
- `design-system/soletrade/pages/public-invoice-quote.md` - public page overrides

When building a page, check `pages/<page>.md` first; if it exists it overrides the
Master. Design tokens are wired into `src/app/globals.css` as Tailwind v4 `@theme`
variables.

## Implementation phases

Multi-phase build. Do not build product modules until workspace, module-installation,
and billing foundations are stable.

- [x] Phase 0 - Repo foundation
- [x] Phase 1 - Core platform (auth, workspaces, permissions, app shell, module model)
- [x] Phase 2 - Shared customers (schema, service, UI, integration tests)
- [x] Phase 3 - Activity feed (event-sourced read side, dashboard + /activity UI)
- [x] Phase 4 - Billing foundation (pricing engine, credit ledger, Stripe)
- [x] Phases 5–8 - Invoices, Books, Drive, Quotes
- [x] Phase 9 - Unified dashboard & cross-module workflows
- [x] Phase 10 - AI assistant (read-only, workspace-scoped, persisted conversations)
- [x] Phase 11 - Hardening + Files/Receipts + in-app notifications + AI write-tools

Local Supabase + the integration test harness are wired (see "Local database &
integration tests" above).