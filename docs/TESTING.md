# Testing the workspace

Run commands from the repository root with Node 24.19.0 and pnpm 10.33.0.

| Command                      | Coverage                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm check`                 | All workspace lint, architecture, types, deterministic tests, formatting and branding |
| `pnpm test` / `pnpm test:ci` | One-shot deterministic tests through Turbo                                            |
| `pnpm test:watch`            | Web Vitest watch mode                                                                 |
| `pnpm build`                 | Next.js production build                                                              |
| `pnpm mobile:export`         | iOS and Android JavaScript bundles                                                    |
| `pnpm test:integration`      | Explicit local Supabase integration suites                                            |
| `pnpm test:stripe`           | Explicit Stripe test-mode and local Supabase suite                                    |
| `pnpm test:e2e`              | Playwright, including a local database reset                                          |

Web Vitest owns web and web-script tests. Its default run excludes every filename
ending in `integration.test.ts[x]`, including `expense-integration.test.ts` and
`integration.test.ts`. The three self-contained PGlite migration suites remain in
the default run and resolve migrations from the repository root.

Mobile Jest owns component/behavior `.test.ts[x]` suites and excludes
`.vitest.test.ts` suites, which mobile Vitest owns. Contracts owns its own Vitest
tests; shared lint tooling owns Node test-runner architecture tests.

## External integration suites

Deterministic setup never loads `.env.local` or probes a database. Integration runs
require an explicit environment file, resolved relative to `apps/web`:

```sh
INTEGRATION_ENV_FILE=.env.integration pnpm test:integration
INTEGRATION_ENV_FILE=.env.stripe pnpm test:stripe
```

The ignored file must provide `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` for disposable local data. Both database and API URLs
must use loopback hosts. Stripe additionally requires `sk_test_` credentials and
the test-mode Books standalone and Invoices addon monthly price IDs. Missing
configuration fails explicitly. These commands bypass Turbo caching and ordinary CI.

For E2E, configure the web application and test server against a disposable local
Supabase stack in an ignored `apps/web/.env.e2e` file. Provide `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY`, plus matching `PLAYWRIGHT_BASE_URL` and
`NEXT_PUBLIC_APP_URL` origins (for example, `http://127.0.0.1:3109`). The API and
database ports must match this repository's `supabase/config.toml`.

Select that file and opt into the destructive local reset explicitly:

```sh
E2E_ENV_FILE=.env.e2e E2E_ALLOW_RESET=1 pnpm test:e2e --workers=1
```

The harness validates targets before starting services or resetting data, starts
its own Next server at the selected origin, and never reuses an existing server.
Persistent Turbopack development caching is disabled for this temporary server.
File values override inherited application settings. Email, SMS, Stripe and
external AI/Redis transports are disabled; the assistant uses the mock provider.
The separate Stripe integration command exercises Stripe test mode. Use one E2E
worker to avoid contention between scenarios that share seeded data.

Never point E2E at a shared development or production database. Run external suites
and device/Maestro journeys separately; a successful Expo export does not validate
device permissions, purchases or background behavior.
