@AGENTS.md

# Soletrade project notes

Soletrade is a workspace-first business product: invoices, quotes, books and
Drive, sharing auth, billing, customers, files, activity and AI. Repository identity
is `soletrade`; product branding comes from `apps/web/src/config/brand.ts` and
URLs from `apps/web/src/config/urls.ts`. Preserve the locked `design-system/`.

## Architecture

Read `docs/ARCHITECTURE.md` and `docs/TESTING.md`. The pnpm/Turborepo workspace has
Next.js in `apps/web`, Expo in `apps/mobile`, and platform-safe shared code in
`packages/contracts`. Keep framework/runtime dependencies app-owned.

Both apps use thin framework routes, feature-owned code and application composition.
Feature siblings cannot import each other; generic shared code cannot import
features. The web backend flows application → domains → foundation → infrastructure.
Cross-domain workflows belong in server application code. Browser-safe models and
calculations live in `apps/web/src/lib/domain`; client code cannot import server
implementations. Dedicated Server Action files retain their `use server` directive.

## Data and authorization invariants

- Supabase JS/PostgREST is the data layer, not an ORM. The service-role client in
  `apps/web/src/server/infrastructure/db/client.ts` bypasses RLS. Every service must
  scope reads/writes to the workspace resolved from the authenticated request.
- Never trust client-provided workspace IDs. Use the non-redirecting context resolver
  for public/error paths and request handlers that must not redirect.
- PostgREST has no multi-statement transactions; atomic operations use the existing
  PL/pgSQL RPCs. Financial mirrors remain atomic, idempotent database triggers.
- Generated database types live in `apps/web/src/server/infrastructure/db/types.ts`.
  `pnpm db:types` regenerates them from the local schema. Browser enums have a
  server-side compile-time compatibility assertion against generated types.
- Migrations, CLI configuration and local-only seed data remain in `supabase/`.
  `pnpm db:reset` destroys local data; never use it for shared/production data.
- Preserve Zod validation, permissions and audit behavior at server boundaries.

## Events and startup

The typed event bus is infrastructure. `apps/web/src/instrumentation.ts` composes
startup wiring through server application services. Workspace creation provisions
subscriptions; notification subscriptions handle best-effort email/in-app effects.
Financial consistency does not depend on the event bus.

Mobile background-task registration must remain at module scope. Native startup,
account cleanup and session/offline coordination belong in application providers.

## Commands and environment

Run commands from the repository root. `pnpm dev` starts web; `pnpm mobile:dev`
starts Expo; `pnpm dev:all` starts both. `pnpm check` covers all workspaces.
`pnpm build` builds Next; `pnpm mobile:export` exports iOS and Android bundles.

`pnpm test:ci` runs deterministic tests only. Explicit integration commands require
`INTEGRATION_ENV_FILE` and disposable local Supabase; Stripe tests require test-mode
keys. Playwright requires `E2E_ALLOW_RESET=1` because its setup resets local data.

Web env files live in `apps/web`, mobile env files in `apps/mobile`. Never commit
credentials. Server env validation lives in server infrastructure; optional secrets
are asserted at each provider boundary. Browser public values retain their framework
prefixes. `pnpm stripe:setup --env-file .env.prod` resolves the file from `apps/web`.

All five cron entries remain in `apps/web/vercel.json`; preserve paths and auth.
Follow `docs/DEPLOYMENT.md` for the coordinated Vercel root-directory cutover.

Before modifying Next code, read the installed documentation at
`apps/web/node_modules/next/dist/docs/`. Next params/searchParams are async, and
Server/Client boundaries must remain intact. Preserve money formatting and branding.
