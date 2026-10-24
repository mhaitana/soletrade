# Soletrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the selected Soletrade product name across the existing app while preserving Matt Haitana as the parent brand.

**Architecture:** Retain `src/config/brand.ts` as the source of product identity. Existing consumers inherit the new name; replace remaining hardcoded admin copy with config references and update the old-name guard. Align current documentation without rewriting historical research or migrations.

**Tech Stack:** Next.js 16.2.10, React 19, TypeScript, Vitest, Playwright.

**Spec:** `docs/research/2026-10-24-product-naming.md`, plus the owner's explicit instruction to apply Soletrade across the app.

## Global Constraints

- Full product name: `Soletrade`; compact product label: `Business`.
- Parent/company name: `Matt Haitana`; full wordmark: `soletrade`; assistant: `hAI`.
- Preserve `One workspace to run your business.` as the current tagline.
- Preserve the `soletrade` repository/package/Stripe identifiers, tenant `workspace` identifiers, URLs and payment statement descriptors.
- Preserve merchant names as document issuers; inherit the new product fallback from the central config.
- No external DNS, deployment, email account or Stripe API mutations.
- Read installed Next.js metadata and manifest guides before editing app code.

## Review Focus

- Admin screens must use the central brand rather than another hardcoded name.
- Installed-app names must use Soletrade / Business while retaining icon assets.
- Full logos and email/PDF headers must retain the parent wordmark.
- Historical names and stable technical identifiers must not trigger broad replacement.
- Existing Stripe products require a separate display-name update; their IDs remain stable.

## Task 1: Update product identity and remaining app references

**Files:** `src/config/brand.ts`, its existing test, `src/app/manifest.test.ts`, three admin pages/layouts, shared logo comments, module/Stripe comments, `scripts/check-branding.ts`, `public/sw.js`, its Playwright smoke test, and `package.json` description.

**Interfaces:** Preserve the exported `brand` shape and all APIs. Consumers read the new `productName`, `shortProductName` and description values.

- [x] Update existing brand and manifest expectations to Soletrade / Business; run them and confirm failures against the previous identity.
- [x] Change central product values, use `brand.productName` in hardcoded admin copy, align active comments and worker smoke assertion, and add `soletrade workspace` to the deprecated-brand check.
- [x] Run branding check, affected tests, type-checking and lint; build the app and inspect public markup/manifest if the local runtime permits.

## Task 2: Align documentation and review

**Files:** `README.md`, `CLAUDE.md`, design-system master, deployment runbook, admin-area prompt, and the naming research rollout status.

**Interfaces:** Document the same selected identity and preserved parent/technical names from Task 1.

- [x] Update current product documentation and package description; preserve historical research/migrations and current URLs.
- [x] Check formatting for changed files and review the full diff with a fresh reviewer.
- [x] Record verification and any limits; leave the changes available for user review without committing or deploying.

## Execution notes

The owner explicitly requested implementation after selecting the name and reviewing the rollout scope. Continue without another approval round. Root handles source and tests; a documentation helper owns only the listed current documents. Existing tests cover these copy/config changes; add no redundant test suite.

## Verification results

- Updated brand/manifest expectations failed against the old config as expected (5 failures), then all 47 affected tests passed across eight files.
- `pnpm test:ci --maxWorkers=2`: 72 files passed, 29 skipped; 631 tests passed, 217 skipped. The initial unrestricted-worker run alongside the build hit timeouts; the bounded rerun passed without source changes.
- `pnpm type-check`, `pnpm lint`, formatting for changed files, and `git diff --check` passed.
- The branding guard passed via `node --import tsx scripts/check-branding.ts`; the `tsx` CLI's IPC socket is restricted by the sandbox.
- `pnpm build` passed with network access to fetch the app's existing Google Fonts. The first restricted-network attempt failed at that fetch step.
- Inspected generated production HTML for home, pricing, privacy, terms and support: title/application/Open Graph names use Soletrade; creator/publisher remain Matt Haitana; the soletrade wordmark remains present; the old product name is absent.
- Verified the service-worker asset carries the new name. The full Playwright harness was not run because it resets the local seeded database; the changed smoke assertion matches the checked asset.
- Fresh read-only review found no Critical, Important or Minor issues. Live Stripe/email/DNS configuration and visual browser/PDF appearance were outside that review; local source and production HTML checks establish the naming changes without mutating those services.
- At the end of the local app pass, existing saved Stripe product display names required a separate external follow-up. That follow-up was completed after the owner's later authorisation, as recorded below; product IDs, prices and subscriptions remain stable.

## Authorised Stripe follow-up

After the local app rename, the owner explicitly authorised updating existing Stripe product display names. On 24 October 2026, all four matching products in live mode and all four in test mode were renamed through the connected Stripe account. Fresh reads confirmed that only `name` and Stripe's automatic `updated` timestamp changed. See `docs/research/2026-10-24-stripe-product-renames.md` for the verified record. The previously outstanding Product-name follow-up is complete.

## Authorised email sender follow-up

The owner then requested the Soletrade sender name while retaining the existing soletrade.example address. The app's Resend client now formats its From header with `brand.productName` and the unchanged bare `EMAIL_FROM` address. The production env file still contains `support@soletrade.example`, yielding `Soletrade <support@soletrade.example>`. No environment values, recipients or email addresses changed.

The new regression test failed against the previous bare-address header and passed after the client change. All 31 tests across email, environment validation and notification templates/services passed, along with type-checking, lint for changed source files, formatting and diff checks. A fresh read-only review found no material issues. Tests mocked the Resend transport; no real emails were sent.

This source change went live in the authorised production deployment recorded below. Supabase signup and sign-in emails bypass the app's Resend client and use separate Auth SMTP settings; the owner's later authorised hosted update is recorded below.

## Authorised Supabase Auth sender follow-up

On 24 October 2026, the owner explicitly requested the same sender name for Supabase signup and sign-in emails while retaining the existing soletrade.example address. In the authenticated Chrome work profile, the hosted project `oqzbzifuliwgfzogmorl` (`Soletrade Workspace`, organisation `soletrade` / `peomjjvpauitelllpiuu`, `main` production branch) already had custom SMTP enabled. Only its sender name was changed, from `Support | soletrade` to `Soletrade`; the sender address remains `support@soletrade.example`.

After saving, a full dashboard reload confirmed the persisted name and address, enabled custom SMTP, and the existing `smtp.resend.com:465` provider with username `resend` and hidden stored password. The Auth Hooks page showed no configured hooks. No credentials, authentication policies or other SMTP fields were changed, and no authentication emails were sent. Verification screenshot: `/private/tmp/soletrade-supabase-sender.png`.

The hosted Auth sender setting is live without an app deployment. The app's separate transactional sender source change also went live in the production deployment recorded below. The deployment runbook records both settings.

## Authorised production deployment

On 24 October 2026, the app rebrand and Resend sender change were deployed to the existing Vercel project `soletrade` (`prj_zBA4wDqEbnvuaIe80lfAJXM1Y8GR`), team `soletrade` (`team_0vjGsS0sNT8NNZVXYX2LZgCs`), using Next.js and Node.js 24. Deployment `dpl_BhWSjdFvfHMvL8gHviTpZxGaBbLK` is available at [its deployment URL](https://soletrade-5pz5t3wph-soletrade.vercel.app) and was promoted through the connected Vercel tools after staged production checks. Its alias mapping for the existing production domain [business.soletrade.example](https://business.soletrade.example) completed successfully. The old `workspace.soletrade.example` alias returned 404 during post-deployment checks; no domain migration was performed.

The deployed source came from an isolated copy of the reviewed, uncommitted working tree, based on commit `0a060b58e9e6fb1fdf810295955b824af8092cb8`. All 593 uploaded source-file SHA-1 hashes matched that copy exactly; snapshot SHA-256: `4756d8fa29fefdb9f07ffffbb65a55be814a30a89bab53afb54834b556e00227`. No local environment, generated or credential files were uploaded. No commit or push was made.

- Fresh focused tests passed (33 tests), along with type-checking. Vercel reported the build `READY`, with a 46-second build and 56 seconds total deployment time.
- Staged and public `/`, `/login` and `/pricing` returned HTTP 200 from the new deployment, with Soletrade titles and the old product name absent. The public `/api/manifest` returned name `Soletrade` and short name `Business`; Matt Haitana remained present as the parent brand.
- A live Chrome homepage check confirmed the Soletrade title and product label, soletrade wordmark, and `© 2026 Matt Haitana` footer. Verification screenshot: `/private/tmp/soletrade-live.png`.
- Remote production `NEXT_PUBLIC_APP_URL` was already `https://business.soletrade.example`, `EMAIL_FROM` remained `support@soletrade.example`, and `RESEND_API_KEY` was present without reading its value. The deployed Resend client formats the sender as `Soletrade <support@soletrade.example>`.
- No runtime error or fatal logs were returned for this deployment in the 15-minute lookback at verification. The log-drains endpoint returned 404, so drain status was unavailable.
- No emails were sent, migrations run or environment values changed during this deployment.

## Subsequent HB application lockup

The owner subsequently requested the HB branding for the in-app logo and account screens. This supersedes the earlier decision to retain the parent wordmark in full shared UI logos: the shared `Logo` now pairs the installed app's HB artwork with `Soletrade`, or `Business` in compact layouts. Mark-only document branding stays visually secondary to the merchant.

Matt Haitana remains the parent company in publisher metadata and copyright, including a visible copyright line on login and signup. The existing `brand.wordmark` value remains `soletrade` for email/PDF headers. The mobile marketing header uses the compact product lockup to accommodate the longer full name.

## Subsequent HB email and document branding

The owner then requested HB branding for email templates and invoice/quote PDFs, explicitly including Supabase authentication emails. This supersedes the earlier email/PDF-header decision: these communications now use the HB mark and Soletrade name. Matt Haitana remains the parent in copyright and document producer metadata. The unchanged `brand.wordmark` is still available to legacy parent-branded reports.

All eight application notification templates share an inline-styled, responsive table header with the public HB PNG, visible product name, parent footer and plaintext attribution. Subjects, business values, status accents and action URLs are preserved. The six core Supabase Auth template sources are retained in `supabase/templates/`; their hosted rollout is recorded separately in `docs/research/2026-10-24-hb-auth-email-templates.md`. Both existing senders remain `Soletrade <support@soletrade.example>`.

Invoice and quote PDFs use native HB vectors, product headers, repeating parent attribution and page numbers. A supplied workspace name remains the document issuer and is also used as author metadata; the existing product fallback remains when it is unavailable. Amounts, taxes, payment details, quote scope and terms remain intact. The Books P&L report is outside this follow-up.

Verification: the full single-worker suite passed with 657 tests and 217 expected database integration skips. The four PDF branding cases also passed after making the long-invoice fixture totals coherent. Type-checking, lint, the deprecated-brand guard and the production build passed. Browser previews for all eight notification templates and six Auth sources fit at 320px, loaded the public HB image and retained parent attribution. Synthetic invoice and quote PDFs were rendered and visually inspected in one- and four-page forms; all pages passed text-boundary, repeating-footer, page-number and merchant/product/parent metadata checks. No real emails were sent or customer records created.
