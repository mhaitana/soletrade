# Soletrade mobile implementation

Approved specification: the implementation plan supplied in the conversation on 25 October 2026.

## Binding decisions

- Expo SDK 58, Expo Router, iOS/Android native development builds; retain the root Next.js app.
- Australia first, phones with responsive tablet layouts. Full customer feature parity before public release; operator `/admin` stays on web.
- Home / Sales / Money / Drive / More; warm neutral/blue branding, light/dark, native accessible forms/lists, hAI and global search.
- Existing services remain authoritative. Native uses verified Supabase bearer tokens and explicitly validated workspace membership, role, module and suspension checks.
- Versioned `/api/v1` JSON API, ISO dates, cents/metres, typed errors, pagination, idempotency and optimistic concurrency.
- Offline new capture/drafts only: durable SQLite outbox/files, immutable user/workspace binding, explicit Save queues writes. Online only for financial transitions, sends, conversion, tax lodging, OCR, hAI and billing.
- One reviewed mileage record per Start/Stop Shift. Background capture, pause/resume, gaps/recovery/correction. No automatic business-purpose inference. Optional gig-app reminders; manual recording always works.
- GPS sync defaults off; precise routes private to recorder and retained until deletion/account closure. Workspace receives reviewed summary only. Deletion tombstones clear enrolled devices on reconnect.
- Receipt capture/OCR review distinguishes creating an expense from attaching to an existing record. Sharing, biometric lock, haptics and shortcuts included.
- Widgets: quick actions and last-synced overview, workspace/freshness/privacy controls. Actions open app. Push: important configurable categories, durable jobs/retries/token cleanup, device-local quiet hours 22:00–07:00.
- Native store catalog: 15 module sets, monthly/yearly; Apple 30 products in one group, Google 15 products with two base plans. Target AUD price = web bundle × 1.20, rounded up to available store price.
- Direct native purchases plus backend verification/notifications. Provider-neutral contracts, original purchase binding and event deduplication; one current billing authority per workspace; one store-paid workspace per purchaser. No double billing. Switch providers only after old coverage ends.
- Native provider controls proration, swaps, renewal and refunds. Stripe coupons/credits remain Stripe-specific. Store payments never become monetary credit. OCR included for store-billed Books workspaces across all clients/members; existing Stripe OCR configuration retained.
- Account deletion in app and public web entry: transfer to accepting member or close owned workspaces; revoke access immediately, purge personal/closed-workspace content within 30 days. Shared business records retain anonymised attribution. Explain exports, cancellation and backups; update privacy/terms.

## Deliverables

1. Shared contracts; authenticated API context, bootstrap, versioned routes and retry safety.
2. Native shell/auth/workspaces and complete business feature screens.
3. SQLite drafts/sync, camera, GPS, push, widgets, sharing and app lock.
4. Provider-neutral subscriptions, store verification, account closure and privacy surfaces.
5. Automated/backend/web/native validation; physical-device and sandbox/store release gates.

## Implementation interfaces

- Shared package name: `@soletrade/contracts`; entry: `packages/contracts/src/index.ts`.
- JSON successes: `{ data: T }`; failures: `{ error: { code, message, fieldErrors?, requestId? } }`.
- API prefix `/api/v1`; workspace resources `/workspaces/:workspaceId/...`.
- Resource paths: `dashboard`, `customers`, `invoices`, `quotes`, `books/transactions`, `books/receipts`, `books/tax`, `drive/earnings`, `drive/trips`, `drive/vehicles`, `drive/expenses`, `drive/settings`, `files`, `activity`, `audit`, `notifications`, `members`, `invitations`, `settings`, `assistant/conversations`, `search`, `billing`.
- Collection responses: `{ items: T[], nextCursor?: string | null }`; detail response is the entity. IDs and timestamps preserve existing domain field names.
- Mutations use POST/PATCH/DELETE. Lifecycle actions use `/:id/:action` with POST. Upload initiation is `files/upload`; file signed reads are `files/:id/read-url`; PDFs are `invoices/:id/pdf`, `quotes/:id/pdf`, `books/report`; exports are `books/export`, `drive/export`.
- Native transport type `MobileRequest`: `(path, {method?, body?, idempotencyKey?, version?}?) => Promise<T>`. Paths are relative to `/api/v1`, beginning `/`.
- Backend context interface uses existing `WorkspaceContext`; root supplies `requireMobileContext(request, workspaceId)`, `MobileApiError`, `mobileJson`, `mobileRoute`, `runMobileMutation` in `src/platform/mobile/http.ts`.
- Business API adapter exports `readMobileResource(ctx, path: string[], query: URLSearchParams)` and `writeMobileResource(ctx, path: string[], method, body)`; result may be `Response` for binary/stream output. Mutations receive optional `ctx.operationId` for retry-safe create IDs.
- Device feature components receive `{ userId, workspaceId, request, onSaved? }` (`MobileFeatureProps`). Exports: `ReceiptCaptureScreen`, `ShiftScreen`, `DraftsScreen`, `DeviceSettingsScreen`, `StorePurchaseScreen` from mobile `src/native/screens`.

## Verification gates

No duplicate records/mirrors/OCR charges after lost responses. No cross-workspace drafts, widgets or restored purchases. Existing web tests remain passing. Test revoked permissions/modules, stale edits, authentication deep links, offline replay, provider webhook ordering/refunds/restore and accessible UI states. GPS/push/widgets/IAP require physical-device and store-sandbox checks before release.
