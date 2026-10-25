# Complete monorepo and Bulletproof React refactor

## Approved design

Complete the pnpm workspace with Turborepo; move Next.js into `apps/web`, retain Expo
in `apps/mobile`, and organize both by feature. Keep backend services in the web
application. Preserve URLs, API contracts, authorization, database behavior, branding,
native integrations, and framework/runtime dependency versions. The pre-existing
mobile Row badge defect is the sole intentional UI correction.

Apps use thin `app` adapters, `application` composition, feature-owned UI/actions and
app-local shared code. Web server dependencies flow application → domains → foundation
→ infrastructure. Browser-safe rules and DTOs live in `lib/domain`. Contracts remains
the only shared runtime package; lint/TypeScript configuration packages share tooling.

## Implementation record

- [x] Create migration branch and relocate web source, configs, assets, scripts and tests.
- [x] Extract currency contracts, curate package exports, retain root compatibility.
- [x] Reorganize web and mobile features; preserve framework adapters and native startup.
- [x] Separate backend layers and repair context, billing, AI, notifications, PDF and webhook seams.
- [x] Enforce import direction, workspace exports and runtime cycle rules.
- [x] Assign all tests to their owning package; isolate external integration suites.
- [x] Configure Turbo task dependencies, environment hashing and app-specific commands.
- [x] Update CI, documentation, ignore rules, environment examples and deployment cutover instructions.
- [x] Map all 164 original test files (151 unit/integration plus 13 E2E) to retained owners.

## Decisions made during implementation

- Use `refactor/bulletproof-monorepo` in the existing checkout to preserve installed
  dependencies and local environment configuration. The initial implementation phase
  made no main-branch commits or remote writes; the later release is recorded below.
- Expo retains its framework ESLint base and consumes shared architecture rules;
  combining both TypeScript ESLint bases registers the same plugin twice.
- Integration tests can compose domain layers; workspace import ownership still applies.
  Runtime production code has no architecture exemptions.
- Database/Stripe integration commands require an explicit local test environment file.
  E2E retains its existing reset behavior but requires `E2E_ALLOW_RESET=1`.
- Preserve React/TypeScript versions independently between apps. Lockfile comparison
  confirmed existing direct dependency versions were unchanged.
- Run web checks sequentially after disk pressure interrupted a parallel test run.
  Remove only obsolete generated output from the former root Next application.

## Implementation verification evidence

Baseline: web types/lint and mobile lint passed; mobile types failed on the existing
unsupported Row badge prop. The new Row regression failed before the fix and passed
afterward.

The completed deterministic run includes 98 web suites / 864 tests, 16 mobile Jest
suites / 73 tests, 10 mobile Vitest suites / 51 tests, and 2 contracts suites / 14 tests.
Architecture tooling additionally verifies boundary, cycle, and task-environment behavior.

Passed: frozen pnpm install, workspace type checks/lint, runtime cycle scan, formatting,
Next production build, and iOS/Android Expo export. Every original Next entrypoint and
public route configuration remains. Cache probes confirm contract-source changes
invalidate both consumers and public environment changes invalidate the web build.

Local production-build HTTP smoke checks: `/`, `/login`, `/pricing`, `/api/manifest`, and the
versioned PWA icon return 200; unauthenticated `/api/v1/bootstrap` and `/api/cron/mobile`
return 401.

Independent review found one P2 issue: Turbo strict mode omitted the supported
`APP_URL` fallback. Added it to hashed build/development environment inputs and verified
a failing-then-passing task-hash regression. No other P1/P2 findings.

## Production cutover - 25 October 2026

- [x] Push the refactor branch and verify a Vercel preview build.
- [x] Fast-forward and push `main` to the refactor at `65c3257`.
- [x] Set the existing Vercel project's root to `apps/web`, enable source files outside
      the root, retain Node.js 24 and set the build command to `pnpm build`.
- [x] Deploy the release through Vercel's Git integration and verify the production domain.
- [x] Complete GitHub CI, including web build and iOS/Android exports.

The release uses the existing `soletrade` project in the `soletrade` team
(`prj_zBA4wDqEbnvuaIe80lfAJXM1Y8GR`). The initial cutover release commit is
[`1d3125183f90380a2d8062a34801914aa04960dc`](https://github.com/soletrade/soletrade/commit/1d3125183f90380a2d8062a34801914aa04960dc).
Production deployment
[`dpl_FgQ1tAihg5718SzeV5eMqCDU17JN`](https://vercel.com/soletrade/soletrade/FgQ1tAihg5718SzeV5eMqCDU17JN)
reached `READY`, with [business.soletrade.example](https://business.soletrade.example)
mapped to that deployment. Hosted credentials, callback URLs, project identity,
domains and all five cron schedules were preserved. No database migrations were run.

The preview built successfully from `/vercel/path0/apps/web` with pnpm 10.33.0 and
resolved the shared workspace packages. Public pages, manifest and icon passed.
Its mobile bootstrap returned 500 because the preview lacked Supabase variables
configured only for production. Production retained those variables and returned the
expected unauthenticated 401; production secrets were not copied into preview.

Two CI follow-ups addressed CPU contention on the shared runner:

- `a42ef37` serializes workspace test tasks in `test:ci`.
- `1d31251` limits web Vitest to one worker in CI, retaining four workers locally.

These changes resolved five-second mobile and web test timeouts without changing
assertions, deadlines or application behavior. The final
[CI run 40159874785](https://github.com/soletrade/soletrade/actions/runs/40159874785)
passed frozen installation, lint, types, architecture checks, all 1,020 deterministic
tests, formatting, branding, the Next production build and both mobile exports.
The test total includes 18 architecture tooling tests in addition to the suites above.

Hosted smoke checks verified 200 responses for `/`, `/login`, `/pricing`,
`/api/manifest`, the versioned PWA icon and sampled Next CSS/JavaScript assets.
Unauthenticated `/api/v1/bootstrap` returned 401 with `UNAUTHENTICATED`; all five
cron routes rejected unauthenticated requests with 401. Core page, manifest, icon,
bootstrap and mobile-cron checks were repeated successfully on the final deployment.
The post-deployment error/fatal log scan found no entries for that deployment.
These checks confirm routing and access protection, not successful execution of
authenticated business workflows or scheduled cron jobs.

External Supabase/Stripe integration suites, destructive Playwright E2E and
physical-device journeys were not run as part of the cutover. Follow
[`docs/TESTING.md`](../../TESTING.md) and [`docs/DEPLOYMENT.md`](../../DEPLOYMENT.md)
for those environment-specific steps and rollback guidance.

## Follow-up local integration verification - 25 October 2026

Subsequent verification used the repository's disposable loopback Supabase stack,
Stripe test-mode credentials, and an isolated Next development server. The original
local database was backed up before resetting it. Email, SMS and external AI
transports were disabled for the browser tests.

- Supabase: **28 suites / 215 tests passed**.
- Stripe: **1 suite / 2 tests passed**, including cleanup of test customers,
  uncompleted Checkout sessions and local billing records.
- Playwright: **108 passed / 46 viewport-specific skips / 0 failed** across Desktop
  Chrome, iPhone, Pixel and iPad profiles. All 154 discovered cases were accounted for.
- After the member-date fix, the focused dialog and signature rerun passed
  **18 tests**, with **4 viewport-specific skips** and no hydration errors.
- After synchronizing quote-search navigation, the affected quote flows passed
  **15 tests**, with **3 viewport-specific skips** across all four profiles.

All 29 focused regression tests, the whole-web type check, changed-file lint and
formatting, and workspace runtime-cycle checks also passed.

The follow-up repaired monorepo test-path resolution, cleanup dependencies on billing
contracts and notification outbox rows, and stale idempotency assertions. The E2E
harness now requires an explicit local environment file, validates the repository's
Supabase ports, owns its server, and bounds the Docker status check. Persistent
Turbopack development caching is disabled during E2E after cache growth exhausted
local disk space; the local Docker engine was recovered without deleting containers
or volumes.

Browser verification also found and fixed two application issues: Audit log navigation
now respects role permissions in the shell and command palette, and member join and
invitation expiry dates use explicit numeric UTC formatting to avoid Node/WebKit
hydration differences. New regressions cover role changes and date hydration across
timezones. These fixes were subsequently released in `9451b66`, as recorded below.
Physical-device journeys remain outside this verification.

Instrumented WebKit runs traced remaining development chunk warnings to cancelled
requests during native quote-search reloads. Asset responses were 200 or 304, with
no missing assets or server-error responses; public quote acceptance had no failed
requests. Temporary request diagnostics were removed after verification.

## Follow-up production release - 25 October 2026

- [x] Commit the integration, E2E and application fixes on `codex/local-integration-e2e`.
- [x] Push the branch, fast-forward `main` to the release commit and push `main`.
- [x] Verify CI and the Vercel production deployment for that exact commit.
- [x] Verify the production domain with HTTP and Chromium/WebKit smoke checks.

The release commit is
[`9451b6698ce1481c138b467dc31a211ef224af57`](https://github.com/soletrade/soletrade/commit/9451b6698ce1481c138b467dc31a211ef224af57)
(`fix: stabilize integration tests and browser workflows`). The merge retained the
previously released Drive bulk earnings change in `670423f`.

[CI run 40167485691](https://github.com/soletrade/soletrade/actions/runs/40167485691)
completed successfully: frozen installation, `pnpm check` (lint, architecture, types,
deterministic tests, formatting and branding), `pnpm build`, and `pnpm mobile:export`
for iOS and Android. The 29 focused regression tests also passed before committing.
The local Supabase, Stripe and Playwright results above cover the external integration
and browser suites that are separate from the ordinary CI workflow.

Vercel's Git integration deployed the same commit from `main` as
[`dpl_DdRVAHuDppGqZ9wn7FGMU3gujaBj`](https://vercel.com/soletrade/soletrade/DdRVAHuDppGqZ9wn7FGMU3gujaBj).
It reached `READY` in the existing `soletrade/soletrade` project, with
[business.soletrade.example](https://business.soletrade.example) mapped to the deployment.
The immutable deployment URL is
[soletrade-pp4j97320-soletrade.vercel.app](https://soletrade-pp4j97320-soletrade.vercel.app).
Build logs confirmed `/vercel/path0/apps/web`, pnpm 10.33.0 and Next.js 16.2.10;
the project retained Node.js 24 and Root Directory `apps/web`.

Production verification passed:

- **13 HTTP checks:** home, login, pricing, manifest, versioned icon and sampled
  CSS/JavaScript returned 200; unauthenticated bootstrap returned 401 with
  `UNAUTHENTICATED`, and all five cron routes returned 401. Sampled asset URLs
  identified this deployment.
- **Chromium and WebKit:** all six page/browser combinations passed for home, login
  and pricing, including branding, headings and login controls. Each browser received
  46 successful JavaScript/CSS responses, with zero page errors, failed assets or bad
  asset responses. The run completed at 06:06:08 UTC on 25 October 2026.
- **Runtime logs:** the exact deployment's production error/fatal scan returned no
  entries for 05:06:33–06:06:33 UTC on 25 October 2026.

Production verification used public, read-only requests. Authenticated business flows
were exercised in local/test environments; physical-device journeys and successful
scheduled cron execution were not verified by these production checks. No production
database migrations, provider credentials, callback URLs or cron configuration were
changed for this release.
