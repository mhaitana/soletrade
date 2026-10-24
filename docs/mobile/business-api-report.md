# Mobile business HTTP adapter implementation

The resource composition root is `src/app/api/v1/_lib/resources.ts`. It exports the agreed read/write adapters and uses `@/platform/mobile/http` for authenticated context and typed errors. Root mounts it below `/api/v1/workspaces/:workspaceId` and owns transport auth, request limits, response envelopes and durable operation claims.

## Implemented paths

- `dashboard`; `search?q=...` (permission- and module-filtered results).
- `customers` list/create; `customers/:id` read/edit/delete; `customers/:id/timeline` with accessible invoices/quotes/Books rows and customer activity.
- `invoices` and `quotes` list/create; `/:id` detail/edit/delete; `/:id/pdf`; invoice `/:id/send`, `/:id/paid` (`mark-paid` alias), `/:id/void`; quote `/:id/send`, `/:id/acceptance`, `/:id/convert` (`convert-to-invoice` alias). Existing services publish send emails, events and audit. Conversion requires both modules/permissions and uses the shared atomic quote-to-invoice operation.
- `books/transactions` list/create and `/:id` detail/edit/delete; `books/summary`; `books/receipts` queue, `/:id` detail, `/extract`, `/:id/review`, `/:id/apply`, `/:id/reject`; `books/tax`, `books/tax/lodge`; `books/report` PDF; `books/export` CSV.
- `drive/earnings`, `drive/trips`, `drive/vehicles`, `drive/expenses` list/create and `/:id` detail/edit/delete; `drive/settings` read/edit; `drive/summary`; `drive/export` CSV. Trip vehicle IDs are workspace-validated and persisted.
- `files` completed-only list; `files/:id` detail; `files/upload`; `files/:id/upload-url` renewal/reconciliation; `files/:id/complete`; `files/:id/read-url`; `files/:id` delete. Metadata starts pending. Completion verifies actual storage size/MIME before exposing the file. Explicit transaction/expense PATCH performs receipt attachment.
- `activity`, `audit`, `notifications`, `notifications/count`, `notifications/:id/read`, `notifications/read-all`.
- `members`, `members/:userId` read/role change/remove; `invitations` list/create, `invitations/:id` revoke, `invitations/:id/resend`; `settings` read/edit.
- `assistant/conversations` list/create; `assistant/conversations/:id` detail/rename/write-toggle/delete; `assistant/conversations/:id/messages` streams the existing AI SDK response using persisted history, existing permission-aware tools and the conversation write opt-in.

Lists return `{items,nextCursor}`; details retain domain camelCase fields. Numbers use cents/metres and response serialization yields ISO timestamps. Search, pagination, dates, identifiers and mutation bodies are bounded and Zod validated; strict bodies reject client id/workspace/actor overrides. Books category and Sales issue-date filters apply before pagination. Lists support offsets without previous 200/2000 ceilings. Feed/file cursors preserve Postgres microsecond timestamps. Financial source mirrors remain read-only. Optional `expectedVersion` is checked against domain `updatedAt` before mutation.

## Retry behavior

Quote conversion uses the quote ID as its durable business key, independent of a device's operation UUID. The shared `src/app/_lib/quote-conversion.ts` helper is used by the web quote action, native sales adapter and the web/native assistant tool. The service-only `convert_quote_to_invoice` RPC locks the workspace and quote, creates the invoice and copied lines, records source provenance, transitions the quote, and writes the existing InvoiceCreated/QuoteConvertedToInvoice activity and invoice.create/quote.convert audits in one transaction. It returns the original invoice on repeated submissions (including an old accepted-version retry after conversion), so a lost response cannot create another invoice. Failed transitions roll back all financial rows and history. Accepted quote amounts, tax mode, currency and line snapshots are copied under the lock; the draft retains workspace payment defaults and the configured invoice number prefix/year. The additive migration backfills provenance from valid existing converted-invoice links. Native conversion also passes expectedVersion into the locked transaction for a new conversion.

Create service signatures gained optional final deterministic IDs without changing web defaults. Before-create lookups recover existing workspace-scoped records; conversation and invitation recovery also binds user/inviter. Receipt extraction claims a deterministic processing row before charging/OCR, returning existing processing/completed work on replay. Valid Apple/Google coverage includes OCR across all clients. Receipt application runs through root's atomic `mobile_apply_receipt` RPC. Pending OCR after a worker crash is intentionally retained for reconciliation instead of running a second charge.

Signed upload renewal and initiation return `{fileId,storagePath,completed,uploadUrl}`; `uploadUrl` is null once complete. Renewal inspects pending objects with Storage `info`: matching stored size/MIME completes metadata through the same permission/entity checks, event and audit path as explicit completion. This recovers a PUT that committed bytes before its response was lost or the app stopped before calling completion, as well as an already-completed metadata row with a lost response. Only a confirmed missing object permits another signed non-upsert URL. Mismatched bytes, storage outages, authentication errors and invalid responses fail closed without issuing an overwrite URL. Replayed initiation uses the same reconciliation. Root's durable operation wrapper preserves uncertainty for external sends.

## Changed files

- `src/app/api/v1/_lib/resources.ts`, `src/app/api/v1/_lib/resources.test.ts`.
- `src/app/api/v1/_lib/resources/assistant.ts`, `books.ts`, `common.ts`, `documents.ts`, `drive.ts`, `files.ts`, `overview.ts`, `platform.ts`, `sales.ts`.
- `src/app/api/v1/_lib/resources/files.test.ts`, `receipt-retry.test.ts`, `version-write.test.ts`.
- `src/app/_lib/quote-conversion.ts`, `quote-conversion.test.ts`, `quote-conversion.migration.test.ts`: shared conversion helper and boundary/actual PostgreSQL regression tests.
- `src/app/(app)/quotes/actions.ts`, `src/app/(app)/assistant/tools.ts`, `tools.test.ts`: all production conversion callers use the same atomic operation.
- `supabase/migrations/20261024195525_atomic_quote_conversion.sql`: CLI-generated additive provenance/backfill and privileged atomic RPC. `src/server/db/mobile-types.ts` and the additive overlay in `src/server/db/types.ts` describe it.
- `src/platform/customers/index.ts`: deterministic creates, optional list offset and atomic edit versions.
- `src/modules/invoices/index.ts`, `src/modules/quotes/index.ts`: optional deterministic RPC create IDs and atomic edit versions.
- `src/modules/books/index.ts`: deterministic transaction creates, optional list offset/category filtering and atomic edit versions.
- `src/modules/books/receipt-extraction.ts`: processing claims, store OCR inclusion, atomic application and lifecycle guards.
- `src/modules/drive/index.ts`: deterministic creates, optional list offsets, trip vehicle binding and atomic edit versions.
- `src/platform/ai/conversations.ts`: deterministic create IDs and optional list offset.
- `src/platform/members/index.ts`: deterministic invitation creation/recovery without repeating invitation emails.

Root owns the companion migration/schema additions, transport, billing provider verification, routing, push/GPS and account lifecycle.

## Verification and release gates

- Verified RED then GREEN for initial authorization/validation/retry/lifecycle tests and upload renewal/lost-completion tests.
- Final upload-recovery regression reproduced **7 failing / 2 passing** before the fix; **9 file-adapter tests passing** after it, including committed bytes with pending metadata, repeated completion without duplicate side effects, size/MIME mismatch, failed storage reads and replayed initiation.
- Focused adapter suite: **28 passing** across four files.
- Atomic conversion: RED before the RPC/helper, then GREEN for lost-response/different-operation retries, rollback without an orphan invoice, legacy provenance backfill, current membership/module/state checks, version conflicts and invoice number collisions. The assistant conversion caller also has RED/GREEN regressions for shared conversion and already-converted retries.
- Final combined conversion/assistant/adapter/all-migration verification: **122 tests passing across eight files**.
- `pnpm type-check`: **passing** (including final conversion changes).
- Scoped ESLint: **passing**.
- Full repository suite: **90 files passed / 29 skipped; 744 tests passed / 217 skipped**. An initial unrestricted run entered dependency Zod tests after monorepo configuration changes; it was interrupted and the root corrected dependency excludes.

Database-backed suites require the root migration applied to a configured Supabase instance; those skipped suites and real storage, email, AI provider, device and store sandbox execution remain release gates. Customer, invoice, quote, Books transaction and all Drive entity edits pass the validated expected timestamp to the database update trigger (including the document RPC payload), so the comparison and write share the database row lock; SQLSTATE 40001 maps to HTTP 409. Existing web callers omit the optional argument and retain their prior behavior. Lifecycle and deletion operations retain domain state guards and the supplied-version precheck.
