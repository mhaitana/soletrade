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

- Use the migration branch in the existing checkout to preserve installed dependencies
  and local environment configuration. No main-branch commits or remote writes.
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

## Verification evidence

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

Production HTTP smoke checks: `/`, `/login`, `/pricing`, `/api/manifest`, and the
versioned PWA icon return 200; unauthenticated `/api/v1/bootstrap` and `/api/cron/mobile`
return 401.

Independent review found one P2 issue: Turbo strict mode omitted the supported
`APP_URL` fallback. Added it to hashed build/development environment inputs and verified
a failing-then-passing task-hash regression. No other P1/P2 findings.

External Supabase/Stripe integration, destructive Playwright E2E, physical-device
journeys and hosted deployment changes were not performed. Follow `docs/TESTING.md`
and `docs/DEPLOYMENT.md` for those environment-specific steps.
