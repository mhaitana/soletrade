# soletrade labs Suite

The `app.soletrade.example` SaaS monolith — a workspace-first, multi-module business
operating system for solo traders, freelancers, and gig operators. Four launch modules
(Invoices, Books, Drive, Quotes) share one foundation: auth, workspaces, billing,
customers, files, activity, AI, permissions, and settings.

> Built on strict [bulletproof-react](https://github.com/alan2207/bulletproof-react)
> principles. The design system is locked in `design-system/soletrade/`.

## Stack

- **Framework:** Next.js 16 (App Router) · React 19
- **Language:** TypeScript (strict + `noUncheckedIndexedAccess`)
- **Styling:** Tailwind CSS v4 · shadcn/ui (new-york · Radix)
- **Data:** Drizzle ORM · PostgreSQL (Supabase)
- **Auth:** Supabase Auth
- **Billing:** Stripe Billing (subscriptions, credit ledger)
- **Email/SMS:** Resend · Twilio (optional)
- **Tests:** Vitest · Testing Library · Playwright (later)
- **Package manager:** pnpm

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in secrets as you enable phases
pnpm dev                     # http://localhost:3000
```

The app boots with defaults even without secrets — modules assert their own required
secrets at their boundaries.

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

- `design-system/soletrade/MASTER.md` — global source of truth
- `design-system/soletrade/pages/dashboard.md` — app shell + dashboard overrides
- `design-system/soletrade/pages/public-invoice-quote.md` — public page overrides

When building a page, check `pages/<page>.md` first; if it exists it overrides the
Master. Design tokens are wired into `src/app/globals.css` as Tailwind v4 `@theme`
variables.

## Implementation phases

Multi-phase build. Phase 0 (repo foundation) is complete. Do not build product modules
until workspace, module-installation, and billing foundations are stable.

- [x] Phase 0 — Repo foundation
- [ ] Phase 1 — Core platform (auth, workspaces, permissions, app shell, module model)
- [ ] Phase 2 — Shared customers, files, activity, search
- [ ] Phase 3 — Billing foundation (pricing engine, Stripe)
- [ ] Phase 4 — Cancellation & credit-ledger engine
- [ ] Phases 5–8 — Invoices, Books, Drive, Quotes
- [ ] Phase 9 — Unified dashboard & cross-module workflows
- [ ] Phase 10–12 — AI, notifications, hardening