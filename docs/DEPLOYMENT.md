# Deployment runbook - soletrade Workspace

This is the operator-side checklist for taking soletrade Workspace from local
dev to a production deploy on Vercel. The app is designed to boot without secrets
(modules assert their own required secrets at their boundary), so you can deploy
first and wire services incrementally - but every external integration below is
required for full functionality.

The production application domain is **not hard-coded** - set `NEXT_PUBLIC_APP_URL`
(plus `NEXT_PUBLIC_MARKETING_URL` / `_SUPPORT_URL` / `_PRIVACY_URL` / `_TERMS_URL`)
in your Vercel env. The app deploys equally to `app.soletrade.example`,
`workspace.soletrade.example`, or `workspace.soletrade.example` - whichever you configure.

## 1. Vercel project

1. `vercel link` in the repo root (creates `.vercel/`).
2. Import the project in the Vercel dashboard (Next.js auto-detected).
3. Production environment variables - copy from `.env.example` and fill in
   below. Set them on the **Production** + **Preview** environments as needed.
4. `vercel --prod` to deploy. The build runs `next build` (Turbopack).

## 2. Supabase (auth + database + storage)

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` - from your Supabase project settings.
- `DATABASE_URL` - the **pooled** connection string (Transaction mode, port
  6543). Apply migrations: `pnpm db:migrate` against the production DB (run
  once from your machine with `DATABASE_URL` set, or via a Vercel build step).
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
   **Branding follow-up:** the 4 Stripe products were created with display name
   `soletrade OS - <module>`. Update each product's display name to
   `soletrade Workspace - <module>` and set the statement descriptor to `SOLETRADELABS`
   (shortened `SOLETRADE`) in the Stripe Dashboard - `pnpm stripe:setup` only renames
   *newly* created products (it reuses existing ones by metadata slug
   `soletrade-<module>`). Product/price ids are unchanged.

## 4. Resend (email)

- `RESEND_API_KEY` - from your Resend dashboard.
- `EMAIL_FROM` - a verified sender, e.g. `soletrade Workspace <noreply@soletrade.example>`.
  Verify the sending domain in Resend first (add the DNS records they show you).
- Email is best-effort: a Resend outage never blocks an invoice send (handlers
  are isolated by the event bus). When unset, `sendEmail` returns
  `not-configured` and the app keeps working.

## 5. AI assistant

- `AI_PROVIDER=anthropic` (default `mock` needs no key - fine for a smoke test).
- `ANTHROPIC_API_KEY` - your Anthropic API key.
- `ANTHROPIC_MODEL` - defaults to `claude-sonnet-5`; set to opt into a newer model.
- (Or `AI_PROVIDER=openai` + `OPENAI_API_KEY` + `OPENAI_MODEL`.)
- The assistant route is rate-limited per IP (20/min) and per user (30/min).

## 6. Rate limiting (Upstash Redis) - required for multi-replica prod

The in-memory limiter is per-instance; across serverless replicas each replica
has its own buckets, so the effective limit is `max × replica_count`. For prod:

1. Create an Upstash Redis database (free tier is fine).
2. Copy the REST URL + token into `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.
3. When both are set, `src/server/rate-limit` uses `@upstash/ratelimit`
   (fixed-window, shared across replicas). When unset, it falls back to the
   in-memory counter (dev only).

## 7. Cron jobs (Vercel Cron)

`vercel.json` declares two daily crons (off-:00 minutes to avoid the fleet):

- `17 0 * * *` → `/api/cron/invoice-overdue` - flips due `sent`/`viewed`
  invoices to `overdue` and emails the customer.
- `23 0 * * *` → `/api/cron/quote-expired` - flips `sent`/`viewed` quotes past
  `valid_until` to `expired`.

Both routes authenticate via `CRON_SECRET` (`Authorization: Bearer <secret>` or
`x-cron-secret`). Vercel Cron sends the header automatically when
`CRON_SECRET` is set in your Vercel env. **Generate a strong random string** for
`CRON_SECRET` and rotate it if it leaks. Without it the routes return 401/500.

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