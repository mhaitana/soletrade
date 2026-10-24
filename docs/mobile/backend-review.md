# Mobile backend review — 25 October 2026

Review covered the mobile HTTP/authentication wrapper, versioned API routing and mutation adapters, store verification/events/contracts, account closure/purge, and relevant domain retry paths. This is a targeted correctness review, not certification of every native feature. Findings below describe the code inspected before remediation; the implementation team is actively fixing them.

## P1 — Cached operation results bypass current authorization

`src/platform/mobile/http.ts:175` returned completed responses before invoking resource/module gates. `src/app/api/v1/[...path]/route.ts:158` exposed operation responses after checking only the requesting user ID, without checking the operation workspace. A member can create a Books transaction, lose Books access or workspace membership, and retrieve the saved transaction response through `/operations/:id`; a downgraded member can also replay the completed mutation. Recheck current membership, suspension, resource permission and module access before returning either cached response. Root owns remediation.

## P1 — Store replacement and post-expiry purchases cannot bind

`supabase/migrations/20261024132232_mobile_platform.sql:146` treats a changed Google purchase token as competing coverage, while `:154` never retires old active binding rows. `src/platform/mobile/billing.ts:223` discards Google's trusted `linkedPurchaseToken`. Run the migration's actual `mobile_apply_store_contract` against Google token A with future coverage, then token B: it raises `Existing subscription coverage must end before changing billing provider.` Expire A and apply Apple B or Google C: both raise `duplicate key value violates unique constraint "store_binding_user_active"`. These outcomes were executed in PGlite using the unchanged migration functions.

Google documents new purchase tokens and the verified parent token for replacements in its [subscription replacement guide](https://developer.android.com/google/play/billing/subscriptions). Preserve that provider-verified relationship, allow same-workspace replacement atomically, retire superseded/expired active bindings, and retain immutable historical purchase ownership. Root owns SQL; reviewer now owns verifier changes.

## P1 — Concurrent verified snapshots can restore refunded access

`src/platform/mobile/store-events.ts:95` and `src/platform/mobile/billing.ts:247` fetch provider state before the SQL projection; the contract RPC accepts every snapshot without an ordering guard. Worker A fetches active state, worker B later fetches revoked state and commits it, then A commits its older active result. Executing the actual RPC with active → revoked → delayed active on a database containing every repository migration produced `books: cancelled` followed by `books: active`. Allocate a monotonic verification revision before provider requests and reject older revisions during projection. Root owns SQL; reviewer now owns verifier changes.

## P1 — Closure can delete a workspace transferred concurrently

`supabase/migrations/20261024132232_mobile_platform.sql:190` collects owned workspace IDs without locking those workspaces; `:192` subsequently closes them by ID only. An acceptance can commit between these statements because `mobile_accept_transfer` locks the workspace, not the closing user's row. Closure then marks the recipient's newly acquired workspace deleted. At purge, `:350` deletes its contents before the final owner predicate at `:358`. This is a source-verified transaction interleaving, not a concurrent integration test. Lock workspace rows before capturing closure IDs and revalidate ownership/closed state before any purge deletion. Root owns remediation.

## P1 — Streaming assistant turns bypass mutation replay protection

`src/app/api/v1/[...path]/route.ts:66` bypasses the operation ledger for conversation messages; the `assistant/chat` alias also bypasses it. `src/app/api/v1/_lib/resources/assistant.ts:86` appends and executes a fresh turn every time. Existing assistant write tools call invoice/transaction/OCR services without deterministic operation IDs. A lost stream followed by the same POST can repeat financial creation or OCR. Executing the actual route transpiled with mocked dependencies twice with the same idempotency key produced `{sameKeyRequests:2,businessWrites:2,durableClaims:0}`. Persist a client turn identity, prohibit uncertain turn reexecution, and bind each write tool operation to the turn/tool-call identity. Root owns remediation.

## P2 — Failed or unmatched store work can starve later reconciliation

`src/platform/mobile/store-events.ts:152` selects the 100 oldest `verified_at` values; failure never advances an attempt timestamp. One hundred closed/unverifiable contracts are selected forever, preventing later active contracts from being refreshed. The pending-event query has the same issue: unmatched events return without incrementing attempts, and verification failures occur before the incrementing handler. Advance a last-attempt timestamp for all attempts, rotate fairly, and bound unmatched/failed event retries. Reviewer now owns remediation.

## Validation and limits

- Every repository migration loaded successfully in standalone PGlite during this review. A basic store-covered closed workspace purged successfully; no generic FK purge failure was established.
- Actual migration function execution reproduced store replacement/binding failures and the stale entitlement projection.
- Actual route execution with mocked dependencies reproduced the assistant ledger bypass.
- Bearer verification calls Supabase Auth with the supplied token, rejects malformed/invalid explicit authorization without cookie fallback, and checks user/workspace soft deletion.
- Preflight-only optimistic concurrency was observed and reported separately; root already assigned atomic mutation enforcement. Web privacy/public closure surfaces, billing read completion, and ongoing migration-test repairs were intentionally excluded as known work in progress.
- Production store credentials, Apple/Google sandbox notifications, physical devices and external provider effects were not exercised.

## Reviewer-owned remediation

Implemented in `src/platform/mobile/billing.ts` and `store-events.ts`: pre-provider verification revisions, trusted Google parent-token propagation, strict client verification inputs, projected entitlement reads after an ignored stale snapshot, fair contract/event retry rotation and bounded unmatched/provider-failure retries. Eleven focused tests in `billing.test.ts` and `store-events.test.ts` pass. SQL ordering/binding enforcement and the other findings remain root-owned and are not certified by these mocked provider tests.

## Deferred Google replacement follow-up

Google's [current deferred-replacement guide](https://developer.android.com/google/play/billing/subscriptions#handle-deferred-replacement) describes a new token containing the old entitlement with a future expiry and a replacement marker, plus an undated target item. At renewal, the target gains its expiry and the old marker disappears. The previous expiry sort already selected the old item for that documented payload; the fix makes the selection explicit, excludes undated items from current entitlement selection, and projects confirmed pending modules/interval separately. It does not promote a future product based on client intent or a local clock.

Payment-pending and canceled-pending purchases are rejected before projection, preserving prior paid coverage. Active purchases with acknowledgement pending remain verifiable so native finishing can acknowledge them; these are distinct states in Google's [purchase-processing guidance](https://developer.android.com/google/play/billing/integrate#process). No backend acknowledgement call was added. Native finishing/restore still owns acknowledgement.

The focused suite now passes **21 tests**, including deferred-before-renewal, effective replacement, undated target rejection, missing pending base plan, pending-payment rejection, acknowledgement-pending acceptance and current/pending billing response fields. Provider sandbox execution remains outstanding.

## Final review and purchase preflight follow-up

The original cached-response authorization, store replacement, stale snapshot ordering, outgoing closure/transfer, assistant turn replay, and reconciliation starvation findings are addressed in the inspected implementation. Actual migration tests cover the SQL protections; provider/network tests remain mocked.

Two further store findings were reproduced and fixed:

- A known inactive Apple chain could not return after the workspace's subsequent Google coverage expired. The blanket historical-binding stale check now permits a fresh verified active chain on its original workspace after competing coverage ends, while rejecting older revisions and displacement of live coverage. A full-migration PGlite regression covers this sequence.
- Read-only catalog eligibility did not reserve anything before a store sheet could charge. Durable purchase intents now reserve both purchaser and workspace, keep uncertain/pending outcomes without time-based expiry, resume the same offer, reject conflicting offers/providers/workspaces, and block Stripe checkout reservation. Confirmed store cancellation releases the reservation; verified original binding consumes it atomically. Catalog and SQL retain the purchaser's original store workspace across all historical providers. Initial Apple binding requires its durable workspace intent; Google legacy restoration additionally has its provider-verified workspace hash. Known purchase restoration retains immutable ownership checks. Native handles resumed/uncertain intents as recovery-only to avoid opening another sheet.

Signed Apple renewal data supplies the future product for matching deferred intents, following Apple's [autoRenewProductId definition](https://developer.apple.com/documentation/appstoreserverapi/autorenewproductid). It remains pending metadata rather than current entitlement.

An incoming ownership acceptance could also race the recipient's closure. `mobile_accept_transfer` now locks and validates the active recipient before locking the transfer/workspace, matching closure's lock order. Its regression rejects a deleted recipient even with retained membership and permits the intended active recipient.

The device registration RPC and push worker were inspected for token movement, per-device retry state, stale receipt invalidation, authorization, quiet hours and uncertain sends. No additional blocker was established in those reviewed paths. **62 tests across billing, migration, store-event and push suites pass; scoped ESLint passes.** This does not establish provider sandbox or physical-device behavior.

One separately handed-off purge issue remains root-owned at this checkpoint: `jobs.ts` deletes storage bytes using the captured workspace list before the SQL ownership recheck. The storage phase must use the validated still-closed/owned set too, so a transferred workspace's files receive the same protection as its database records.

## Controller resolution after the final checkpoint

The storage purge issue above is resolved: `jobs.ts` revalidates the captured list against currently closed workspaces still owned by the closing user before selecting any storage path. Lookup failure keeps the job pending without deleting bytes. Two worker regression tests cover a transferred workspace and failed ownership lookup. The SQL purge also removes unfinished purchaser intents from continuing transferred workspaces.

Operational health now counts `processing` operation claims and excludes intentionally retained assistant stream claims; individual assistant write-tool operations remain included. Strict event schema tests reject private fields before logging. The collector receives only event UUID/kind/reason/platform or aggregate counts.

Refunded/revoked/expired store contracts no longer block replacement solely because their historical paid-through timestamp is in the future. Billing retry, Google hold and pause retain billing authority while granting no module access; only provider-confirmed recovery restores access. Unknown provider states fail closed. The focused billing/migration/store-event/purge verification reached 80 passing tests; the implementation ledger records the final full-repository result.

Quote conversion subsequently moved to a shared atomic PostgreSQL operation used by web, native and assistant callers. Its independent provenance, line items, canonical totals, quote transition, events and audits commit together; repeated conversion returns the original invoice. See the API report and conversion migration tests for the later controller-identified interruption fix.
