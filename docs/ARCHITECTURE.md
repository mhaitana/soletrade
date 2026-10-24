# Monorepo architecture

`apps/web` owns Next.js, HTTP APIs, backend services, web UI, assets, scripts and
tests. `apps/mobile` owns Expo, native adapters and both mobile test runners.
Applications consume private workspace libraries through explicit package exports
and `workspace:*` dependencies. Applications never import each other's source.

`@soletrade/contracts` is the only shared runtime package. Its root API is retained;
curated subpaths expose mobile contracts, currencies, business-income calculations,
home overview types and design tokens. It has no React, Expo, Next.js or Node runtime
dependencies. Web and mobile retain their own React and TypeScript versions.

## Frontend direction

Framework routes (`app`) delegate to application composition and domain features.
`application` assembles providers, navigation and workflows spanning features.
`features/<domain>` owns UI, actions, queries, hooks, form schemas and tests.
Features never import sibling features, routes or application composition.

Generic components, hooks, configuration, libraries, types and utilities are
app-local. Shared code cannot import features or application composition. Reusable
web business rules and DTOs belong in `lib/domain`; feature-only rules stay in the
feature. Mobile keeps its generic resource editor/list engine in `features/records`.

## Web server direction

Dependencies flow from `server/application` to `server/domains`,
`server/foundation`, and `server/infrastructure`; each layer can use any lower layer.

- Infrastructure owns clients, transports, storage, environment and generic rendering.
- Foundation owns workspace/customer/billing/identity services and persistence.
- Domains own invoices, quotes, books and drive. Sibling domains do not import each other.
- Application owns request context, authorization composition, admin/mobile APIs,
  assistant tools, quote conversion, notifications, cron and webhook orchestration.

Foundation services can use each other without runtime cycles. Server code cannot
import frontend features or frontend application composition. Server entrypoints
retain `server-only`. Client code uses browser-safe types and calculations or
dedicated `use server` action files; it never imports server implementation paths.

Workspace identity continues to come from the authenticated request. Service-role
data access remains workspace-scoped in code. Atomic financial mirrors remain
database triggers/RPCs; this migration does not replace them with event handlers.

## Enforcement and tooling

ESLint resolves aliases, relative paths, reexports and dynamic imports. Integration
tests may compose domains, but workspace ownership still applies to test code.
`pnpm architecture:check` rejects runtime import cycles, including aliases,
reexports and dynamic imports; type-only edges do not form runtime cycles.

Each workspace owns its lint/type/test commands. Turbo transit tasks hash source-only
package dependencies; lint/type/test/build consumers invalidate when contracts change.
App environment files and relevant environment variables contribute to build hashes.
Development, integration, E2E and database operations are never cached.

Supabase stays at the repository root. Web env files live in `apps/web`; mobile
env files live in `apps/mobile`. Shared packages never load application secrets.
Next/Expo supply their built-in workspace support without custom Metro hoisting.
