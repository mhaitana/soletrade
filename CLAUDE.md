@AGENTS.md

# soletrade labs Suite — project notes

## What this is
The `app.soletrade.example` SaaS monolith: a workspace-first, multi-module platform
(Invoices, Books, Drive, Quotes) sharing one auth, billing, customer, file, activity,
and AI foundation. See `design-system/soletrade/MASTER.md` for the locked
design system and `pages/*.md` for per-surface overrides.

## Architecture (bulletproof-react)
- `src/platform/*` — reusable platform services. MUST NOT import from `modules/*`.
- `src/modules/*` — business product logic. Cross-module side effects go via the event
  bus in `src/server/events`, never direct imports.
- `src/shared/*` — generic UI + utilities only. No app/module/platform imports.
- `src/server/*` — server-only infra (db, stripe, jobs, events, cache, security).
  Each boundary pulls `import "server-only"`.

## Stack
- Next.js 16 (App Router) · React 19 · TypeScript strict (+ `noUncheckedIndexedAccess`)
- Tailwind v4 (CSS-based config in `src/app/globals.css`) · shadcn/ui (new-york, Radix)
- Drizzle ORM + Supabase Auth + Stripe Billing + Resend · Vitest + Testing Library
- Package manager: **pnpm**

## Commands
```bash
pnpm dev          # dev server
pnpm build        # production build
pnpm type-check   # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest (watch)
pnpm test:ci      # vitest run
pnpm format       # prettier --write .
pnpm check        # type-check + lint + tests + format:check
```

## Next.js version warning
This project uses Next.js 16, which has breaking changes vs older training data.
Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`
(App Router). Heed deprecation notices. Key facts: `params`/`searchParams` are
Promises; `PageProps<'/route'>` and `LayoutProps<'/route'>` are global helpers;
Tailwind v4 uses `@import "tailwindcss"` + `@theme` (no `tailwind.config.js`).

## Rules
- Zod validation on every server boundary (Server Actions, Route Handlers).
- Never trust a client-provided `workspaceId` — resolve from the session.
- All money renders use `tabular-nums` (see `globals.css`).
- No business logic in `src/shared/*`.
- shadcn primitives live in `src/shared/ui` (vendored, not linted).