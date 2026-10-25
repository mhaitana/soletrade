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
(`prj_zBA4wDqEbnvuaIe80lfAJXM1Y8GR`). The completed release commit is
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
