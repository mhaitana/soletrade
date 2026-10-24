# Provider-aware web and Stripe compatibility

Web billing and Stripe mutation services now consult the provider-neutral current billing authority before touching Stripe, issuing credit/refunds or changing paid modules. Apple/Google-managed workspaces show their provider, coverage date and original store subscription-management link. Stripe checkout, interval changes, module proration and refund controls are unavailable for those workspaces; server-side checks enforce the same boundary.

## Behavior

- Current Apple/Google coverage, including grace and canceled-but-still-paid periods, blocks web Checkout. Web billing becomes available after verified store coverage ends. Existing Stripe credit is never presented as store subscription value.
- A web Checkout reserves the workspace's billing authority under a database lock before creating a payable session. Checkout expires in 35 minutes and uses a Stripe idempotency key. Session/subscription metadata carries the reservation identity, and the session ID is persisted on its pending contract.
- Web billing shows a pending-checkout state. Cancel pending checkout retrieves and verifies the workspace/session/reservation binding, expires an open session, and only then releases authority. A completed purchase cannot be released. Definitive Stripe request/auth errors release the reservation; ambiguous transport failures retain it through expiry so another provider cannot create an overlapping charge.
- Checkout, subscription update and subscription deletion webhooks call `mobile_apply_stripe_contract`. Contract and module entitlement projection happen under the same workspace lock as store projection. Exact current Stripe subscription IDs and current provider checks reject obsolete events; rejected checkout events also skip promotion redemption.
- Stripe invoice credits require the actual subscription association from the installed SDK's `invoice.parent.subscription_details.subscription` graph. Old subscriptions and store-owned workspaces do not receive grants from late Stripe invoices.
- Module add/remove and the scheduled-cancellation worker use `mobile_change_stripe_module`. The RPC changes contract module membership and the installation atomically, preserving independent concurrent module changes and rejecting a provider switch. Existing module events/audit remain emitted. The cron skips store-owned workspaces and requires a real Stripe subscription.
- A canceled Stripe contract records its actual `ended_at`/`canceled_at`, allowing a provider change after coverage genuinely ends instead of incorrectly waiting until the original period end.
- Existing Stripe web behavior, promotion handling, cancellation options and legacy active subscription rows remain supported. Legacy unbilled cleanup only updates installations that still have no billing-contract owner.

## Changed files

- `src/platform/billing/authority.ts`: shared provider checks, coverage, atomic projection/checkout/module RPC wrappers.
- `src/platform/billing/reconcile.ts`: exact provider/subscription event guards, current contract projection and invoice credit ownership.
- `src/platform/billing/modules.ts`: provider gates and atomic module changes/finalization.
- `src/platform/billing/cancellation.ts`, `cancellation.test.ts`: provider-aware cancellation preview; stores have no Stripe monetary options.
- `src/platform/billing/provider-compat.test.ts`: provider, stale-event, reservation, cancellation and race tests.
- `src/server/stripe/stripe-lifecycle.ts`: low-level Stripe guards, Checkout reservation/idempotency/expiry and safe pending-checkout cancellation.
- `src/server/stripe/handlers.ts`: forwards retrieved subscription details and gates promotion redemption on accepted checkout reconciliation.
- `src/server/stripe/stripe-lifecycle.test.ts`, `checkout-promotion.test.ts`: updated external boundary mocks and reservation metadata assertions.
- `src/server/stripe/handlers.integration.test.ts`: synthetic invoices now include the installed SDK's actual subscription association.
- `src/app/(app)/billing/actions.ts`, `page.tsx`, `pending-checkout-actions.tsx`, `provider.test.ts`: provider display, safe controls and server-action guards.
- `src/app/(app)/actions/module-installations.ts`: guards all module mutations/previews, and displays store modules as read-only.

Root owns the companion RPC migration, database overlays, native store catalog/verification, store event processing and account lifecycle. No live payments or messages were initiated during implementation.

## Verification

Provider guards, stale events, reservation ordering, pending-checkout cancellation, post-expiry switching, Google grace coverage and module authority races were tested at real service boundaries with DB/Stripe mocked. These tests were observed failing before the respective implementation. Final combined billing/Stripe/web/resource suite: **140 passed / 31 integration tests skipped**, across 14 passing files. `pnpm type-check`, scoped ESLint and `git diff --check` passed. Full `pnpm test:ci`: **90 files passed / 29 skipped; 744 tests passed / 217 skipped**.

Real PostgreSQL/Supabase execution and Stripe/store sandbox events require configured external services and remain release gates. Deployment must apply the companion root migration before serving the new billing paths.
