# Deployment runbook - Soletrade

This is the operator-side checklist for taking Soletrade from local
dev to a production deploy on Vercel. The app is designed to boot without secrets
(modules assert their own required secrets at their boundary), so you can deploy
first and wire services incrementally - but every external integration below is
required for full functionality.

The production application domain is **not hard-coded** - set `NEXT_PUBLIC_APP_URL`
(plus `NEXT_PUBLIC_MARKETING_URL` / `_SUPPORT_URL` / `_PRIVACY_URL` / `_TERMS_URL`)
in your Vercel env. The current production URL is
`https://business.soletrade.example`; use the configured domain for each environment.

## 1. Vercel project

1. Keep the existing Vercel project's **Root Directory** set to `apps/web`, with
   inclusion of source files outside that directory enabled. The repository root is
   the pnpm workspace/install root; the project uses Node.js 24.
2. Preserve hosted environment variables. `apps/web/.env.example` documents their
   names; local ignored credentials are never uploaded as source.
3. Use the package's `pnpm build` (`next build`) as the build command. The root pnpm
   lockfile supplies workspace dependencies; Next traces files from the repository root.
4. Create and inspect a preview deployment before switching production. Confirm
   shared contracts resolve, public assets load, and all six cron routes remain configured.
5. For a rebuilt rollback to pre-monorepo source, restore the project's Root Directory
   to the repository root along with that source revision. An existing immutable
   deployment can be rolled back without rebuilding. Restore `apps/web` before building
   current `main` again.

The integration and E2E follow-up was released on **25 October 2026** as
[`9451b6698ce1481c138b467dc31a211ef224af57`](https://github.com/soletrade/soletrade/commit/9451b6698ce1481c138b467dc31a211ef224af57),
merged from `codex/local-integration-e2e` into `main`. Vercel's Git integration
deployed it to the existing `soletrade` project with Root Directory `apps/web`.
Production deployment
[`dpl_DdRVAHuDppGqZ9wn7FGMU3gujaBj`](https://vercel.com/soletrade/soletrade/DdRVAHuDppGqZ9wn7FGMU3gujaBj)
reached `READY` and served [business.soletrade.example](https://business.soletrade.example).
[Release CI](https://github.com/soletrade/soletrade/actions/runs/40167485691)
passed the frozen install, `pnpm check`, web build and iOS/Android exports.

All 13 production HTTP checks passed. Chromium and WebKit verified home, login and
pricing with no page errors or failed assets; the release's post-deployment error/fatal
log scan was empty. The preceding Supabase, Stripe test-mode and Playwright suites
passed in local/test environments. This release includes role-aware Audit log navigation
and consistent UTC member-date rendering, alongside the integration and E2E fixes.
No production database migrations or provider configuration changes were made. See the
[follow-up release record](superpowers/plans/2026-10-25-monorepo-restructure.md#follow-up-production-release---25-october-2026)
for verification scope and evidence.

The initial monorepo production cutover completed on **25 October 2026** in the existing
`soletrade` project under `soletrade`. The refactor was merged into `main`,
the settings above were applied, and Vercel's Git integration deployed release commit
`1d3125183f90380a2d8062a34801914aa04960dc` as
[`dpl_FgQ1tAihg5718SzeV5eMqCDU17JN`](https://vercel.com/soletrade/soletrade/FgQ1tAihg5718SzeV5eMqCDU17JN).
The deployment reached `READY` and was verified at
[business.soletrade.example](https://business.soletrade.example).

[Release CI](https://github.com/soletrade/soletrade/actions/runs/40159874785)
passed the frozen install, full checks (1,020 tests), web build and iOS/Android
exports. Hosted smoke checks passed, and the post-deployment error/fatal log scan
found no entries for the release. Project identity, domains, provider credentials,
callback URLs and all five cron schedules were preserved; no database migrations
were run. See the [completed cutover record](superpowers/plans/2026-10-25-monorepo-restructure.md#production-cutover---25-october-2026)
for verification details and test limitations.

The Soletrade rebrand and app email sender were deployed on 24 October 2026
to the existing `soletrade` project (Next.js / Node.js 24), deployment
`dpl_BhWSjdFvfHMvL8gHviTpZxGaBbLK`. After staged checks, the deployment was promoted
and its `business.soletrade.example` alias mapping completed. Public home, login and
pricing pages and the app manifest verified the new name; Matt Haitana remains the
parent brand. See the [deployment record](superpowers/plans/2026-10-24-soletrade-rebrand.md#authorised-production-deployment)
for source verification and checks.

## 2. Supabase (auth + database + storage)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` - from your Supabase project settings.
- `DATABASE_URL` - the **pooled** connection string (Transaction mode, port
  6543). Apply migrations separately using the existing linked-project `pnpm db:push`
  workflow. Never reset production or run migrations implicitly during the web build.
- **Storage bucket:** create a bucket named `files` (or set
  `SUPABASE_STORAGE_BUCKET` to your chosen name). The Files platform (Phase 11b)
  uses the service-role key, so Storage RLS is **defense-in-depth** - workspace
  scoping is enforced in application code, not at Storage. Add RLS policies that
  deny public access as a backstop.

## 3. Stripe (billing)

1. `STRIPE_SECRET_KEY` - live key (`sk_live_…`). Start in test mode
   (`sk_test_…`) for the first deploy.
2. `pnpm stripe:setup` with the live/test key set - creates the 16 recurring
   Price objects (4 modules × standalone/add-on × monthly/annual) and prints the
   ids. Paste all 16 `STRIPE_PRICE_*` ids into your Vercel env.
3. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - `pk_live_…` (or `pk_test_…`).
4. `STRIPE_WEBHOOK_SECRET` - in the Stripe dashboard add an endpoint for
   `${NEXT_PUBLIC_APP_URL}/api/stripe/webhooks` listening to:
   `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy the signing secret. (For local testing:
   `pnpm stripe:listen` forwards to `localhost:3000/api/stripe/webhooks`.)
   **Product branding:** the 4 module products in both live and test mode were renamed to
   `Soletrade - <Module>` on 24 October 2026. See the
   [verified rename record](research/2026-10-24-stripe-product-renames.md).
   `pnpm stripe:setup` uses the current brand for new products and reuses existing ones by
   metadata slug `soletrade-<module>` without renaming them. Future rebrands require a
   separate Product `name` update. Preserve product/price IDs, metadata, subscriptions and
   existing statement descriptors when changing display names.

## 4. Resend (email)

- `RESEND_API_KEY` - from your Resend dashboard.
- `EMAIL_FROM` - the bare verified sender address, currently `support@soletrade.example`.
  Keep this value as an email address; the app adds the product display name from
  `brand.productName`, sending as `Soletrade <support@soletrade.example>`.
  Verify the sending domain in Resend first (add the DNS records they show you).
- Supabase signup and sign-in emails use Auth's separate SMTP sender settings. On
  24 October 2026, the hosted project `oqzbzifuliwgfzogmorl` was updated to send as
  `Soletrade <support@soletrade.example>`, preserving its existing address and
  SMTP configuration. A full dashboard reload verified the saved sender name and
  address; custom SMTP remains enabled and no Auth hooks are configured. This hosted
  setting is live without an app deployment. The app's separate Resend sender change
  went live in the 24 October rebrand deployment and does not control Auth's sender.
- Email is best-effort: a Resend outage never blocks an invoice send (handlers
  are isolated by the event bus). When unset, `sendEmail` returns
  `not-configured` and the app keeps working.

## 5. AI assistant

- `AI_PROVIDER=anthropic` (default `mock` needs no key - fine for a smoke test).
- `ANTHROPIC_API_KEY` - your Anthropic API key.
- `ANTHROPIC_MODEL` - defaults to `claude-sonnet-5`; set to opt into a newer model.
- (Or `AI_PROVIDER=openai` + `OPENAI_API_KEY` + `OPENAI_MODEL`.)
- Optional per-task models, each defaulting to the chat model above:
  `ANTHROPIC_MODEL_LIGHT` / `OPENAI_MODEL_LIGHT` (short text tasks) and
  `ANTHROPIC_MODEL_VISION` / `OPENAI_MODEL_VISION` (reading receipts).
- The assistant route is rate-limited per IP (20/min) and per user (30/min), and capped at
  400 model turns per workspace per day (an interim spend guard until usage metering exists;
  the constant is `ASSISTANT_DAILY_TURN_LIMIT`).
- Every model call writes one `[assistant] usage` log line (workspace, model, token counts,
  cache reads). Route it to your log collector to see spend per workspace.
- `/api/assistant` and `/api/v1/*` set `maxDuration = 300`; the plan must allow it.

## 6. Rate limiting (Upstash Redis) - required for multi-replica prod

The in-memory limiter is per-instance; across serverless replicas each replica
has its own buckets, so the effective limit is `max × replica_count`. For prod:

1. Create an Upstash Redis database (free tier is fine).
2. Copy the REST URL + token into `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.
3. When both are set, `apps/web/src/server/infrastructure/rate-limit` uses `@upstash/ratelimit`
   (fixed-window, shared across replicas). When unset, it falls back to the
   in-memory counter (dev only).

## 7. Cron jobs (Vercel Cron)

`apps/web/vercel.json` preserves these schedules:

| Schedule     | Route                              |
| ------------ | ---------------------------------- |
| `* * * * *`  | `/api/cron/mobile`                 |
| `17 0 * * *` | `/api/cron/invoice-overdue`        |
| `23 0 * * *` | `/api/cron/quote-expired`          |
| `31 0 * * *` | `/api/cron/credit-expired`         |
| `11 0 * * *` | `/api/cron/module-cancel-finalize` |
| `7 * * * *`  | `/api/cron/assistant-digest`       |

Preserve `CRON_SECRET`; Vercel sends it as a bearer token. The first five route paths and
their authentication behavior are unchanged; the sixth uses the same check.

### Briefing digest (`/api/cron/assistant-digest`)

Sends the opt-in briefing digest. It needs migration
`20261119100000_assistant_briefings.sql`; apply it before deploying. The dashboard reads
its briefing through the same migration's `get_insight_facts` function, and until that
exists it shows "could not be loaded" for the briefing and "Needs attention".

- It runs every hour because each workspace's 07:00 falls in a different hour. A member is
  picked when they chose Daily or Weekly under Settings > hAI, are still an active member,
  it is 07:00 or later in the workspace's timezone (and a Monday there, for Weekly), and
  they have not been picked yet that local day. Nobody is opted in by default.
- The database marks a member as picked before anything is sent (`claim_ai_digests`), so a
  repeated or overlapping run cannot send twice. A run handles at most 200 members and
  stops claiming after 40 seconds; the rest are picked up by the next run.
- A member with nothing to report is sent nothing. Otherwise they get an in-app
  notification and an email through Resend. Without `RESEND_API_KEY` / `EMAIL_FROM` the
  in-app notification is the whole digest; a failed email never blocks it.
- The response is `{ ok, claimed, sent, emailed, skipped, failed }`. `failed` above zero
  means a member's digest could not be built or saved; the error is in the function log.
- No model is called and no new environment variables are needed. The route sets
  `maxDuration = 60`.

## 8. First-deploy smoke test

1. Sign up at the deployed URL → onboarding creates a workspace (Free tier
   subscription auto-provisioned via the `WorkspaceCreated` subscriber).
2. Enable the Invoices module on `/settings/modules` → confirm the Stripe
   Checkout upgrade flow works and the webhook reconciles the subscription.
3. Create + send an invoice → confirm the customer email arrives (Resend) and
   `/activity` shows `InvoiceSent`.
4. Pay the invoice at `/i/[token]` → confirm `InvoicePaid` activity + a Books
   income row (cross-module integration) + the audit log entry on `/audit`.
5. Open `/audit` as the owner → confirm the billing + member entries render.
6. Visit `/assistant` and ask "how's my business doing?" → confirm a streamed
   reply (mock provider is fine if no AI key is set).
7. Confirm Vercel Cron fires at 00:17/00:23 UTC (check the cron logs in the
   Vercel dashboard) and the routes return `{ ok: true, marked: N }`.

## 9. Operational notes

- **Audit log** (`/audit`) is append-only, never soft-deleted, visible to
  owner/admin/accountant. It records sensitive mutations (billing, members,
  modules, per-module create/update/delete) with actor + IP + metadata.
- **Member role changes**: an owner/admin can change another member's role on
  `/settings/members`, but can't change the owner, can't change themselves, and
  can't leave the workspace with zero owner/admin. Every change is audited.
- **Local dev**: `pnpm db:start` (Supabase) + `pnpm db:reset` (migrations) +
  `pnpm dev`. `AI_PROVIDER=mock` and unset secrets keep the app fully bootable.
