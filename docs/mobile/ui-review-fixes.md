# Native UI review corrections — 25 October 2026

Reviewed against `docs/mobile/ui-review.md`. This follow-up changes only the UI/session/transport-owned mobile files and tests. Backend and `src/native` / `src/offline` implementations were not edited.

## Corrected findings

- **Successful account closure:** `screens/tools.tsx` calls `useSession().closeAccount` after `/me/deletion` succeeds. `lib/session.tsx` clears session/bootstrap immediately and shares the same closure path with `ACCOUNT_CLOSED` failures. `lib/account-cleanup.ts` suspends capture, force-purges local account drafts/files/cache/native state, discards private route data, clears widgets/shortcuts and SecureStore preferences, then clears local Auth. It attempts remaining cleanup and local sign-out even if an earlier device cleanup step fails. Auth events cannot reactivate the closing account while cleanup is in progress.
- **Authoritative access/module denial:** `lib/access-denial.ts` recognizes `MODULE_UNAVAILABLE`, `module_unavailable`, `WORKSPACE_UNAVAILABLE`, `ACCOUNT_CLOSED`, and 401/403 independently of the module denial's 404 status. `lib/resources.ts` invalidates outstanding reads, removes visible data, clears workspace references and refreshes bootstrap. Explicit denial stays hidden through subsequent availability failures until a successful authorized read; cached fallback is limited to network/availability failures. `ResourceListScreen` and `ReferenceField` also hide their independently accumulated rows on denial. No queued draft is reassigned to another workspace.
- **Vehicle-expense edits:** `EditorScreen` keeps the vehicle read-only and omits immutable `vehicleId` from PATCH. New expense creation retains and validates the required vehicle link. The expense picker and list filters now use only `fuel`, `maintenance`, `insurance`, `registration`, `other`.
- **Ownership recipients:** `ReferenceField` maps members to `userId` with readable `email`/full-name labels, drops records without a usable identity, and supports `excludeIds`. Ownership transfer excludes the current owner; the submit control remains disabled for an empty recipient.
- **Reference pagination:** reference selectors request bounded pages, accumulate each loaded page without discarding prior choices, offer explicit Load more and search within loaded choices, and fetch an existing selected reference separately when it is outside loaded pages. The UI explicitly labels the search as applying to loaded choices rather than implying an incomplete list is exhaustive.
- **Pending destinations:** `lib/navigation-intent.ts` allowlists native destinations and rejects origins, protocol-relative targets, unsupported screens and control/backslash payloads. `AppShell` carries an incoming path and original user/workspace query binding through sign-in and workspace onboarding. Password authentication, email callback continuation and workspace create/switch replay the destination. A bound shortcut cannot switch accounts or silently fall back to a different workspace: membership is checked, bootstrap selects the requested workspace, and the normal module/permission gates run before displaying the action.

**Rejected-draft correction is now integrated:** `EditorScreen` accepts `draftId` on a new-record route, loads that exact bound draft via `getDraft`, checks its original kind/path/user/workspace and definitive-rejection flags before showing editable data, and calls `correctRejectedDraft` only on explicit Save. The store helper preserves the original draft ID/captures/upload IDs and replaces its operation UUID only after a known pre-effect 400/422 validation rejection. The editor then queues the same draft ID; it never silently calls `createDraft` for recovery. Wrong-binding/resource and uncertain/in-flight/completed drafts cannot be corrected. Race rejection retains entered corrections. Native Drafts links carry the draft and original binding; native captured receipt correction remains in its capture editor. Google purchase replacement is owned by the native worker/root, not this follow-up.

Push navigation additionally requires a successful online `refreshBootstrap` return for the exact user/workspace before opening a bound action. Cached or failed refreshes do not navigate under a previous workspace; exact `/legal` is handled for ownership notifications.

## Regression evidence

Observed RED before the corresponding corrections:

1. Expense PATCH contained `vehicleId`; unsupported parking/tolls options remained; member options produced `undefined`; references had no next-page action (four failures).
2. Successful deletion called ordinary sign-out instead of closure cleanup; incoming receipt destination was replaced by Home after password sign-in and workspace creation (three failures).
3. A 404 module denial retained the previously loaded private invoice records, for both uppercase/lowercase error codes (two failures).

Final native checks:

- `pnpm --dir apps/mobile type-check` — passed.
- `pnpm --dir apps/mobile lint` — passed, zero warnings.
- `pnpm --dir apps/mobile test` — **7 suites, 33 tests passed**.
- New tests: `src/__tests__/ui-review.test.tsx`, `resource-denial.test.ts`, `account-cleanup.test.ts`, `navigation-intent.test.ts`.
- Tests cover exact edit/create payload differences, member IDs/exclusion, later reference pages and independent selected-record hydration, successful closure wiring and cleanup ordering/failure continuation, destination replay through sign-in/onboarding, unsafe destination rejection, and cache eviction/no reread after module-denial remount. Four further recovery tests cover same-bound original-draft correction without cloning, wrong-resource/workspace refusal, and preservation/no queue when correction becomes unsafe at Save.

No new physical-device, store-sandbox or rendered-screen execution is claimed by these fixes. Root owns the final integrated native export and live acceptance checks.

## SDK 58 tooling verification

After the final SDK dependency alignment, `apps/mobile/tsconfig.json` explicitly includes `jest` and `node` global types. TypeScript 6 defaults to an empty global-types list, which caused the previously reported Jest namespace/Node diagnostics. Native tabs now import the supported `expo-router/native-tabs` entrypoint; no app-source `unstable-native-tabs` import remains. This follows the [TypeScript types reference](https://www.typescriptlang.org/tsconfig/types.html) and [SDK 58 native-tabs reference](https://docs.expo.dev/versions/v58.0.0/sdk/router/native-tabs/).

The installed React Native Testing Library is **14.1.0** with **test-renderer 1.3.0**, matching React 19.3. The three UI/hook test files now await `render`, `renderHook`, `fireEvent` and explicit `unmount` according to the installed package guide and [official v14 migration guide](https://oss.callstack.com/react-native-testing-library/docs/start/migration-v14). Root owns dependency manifest/lockfile changes and direct `@types/node` installation.

Verified after the migration with TypeScript **6.0.3** / Jest **30.5.2**: native type-check, lint (zero warnings), **7 suites / 33 Jest tests**, and scoped Prettier all passed. These are tooling/test results; root owns the simulator and signed-binary validation.

## Final upload and extraction review fixes

- `src/screens/upload.tsx` now restores a durable `file-upload:<userId>:<workspaceId>` state through `readState`/`writeState`. It persists the captured file, original binding, create/completion UUIDs, server file ID and storage path before sending bytes. Every explicit Upload attempt renews `/files/:id/upload-url` using a fresh renewal operation (an older signed URL must not be replayed); original create/completion keys remain stable. A completed renewal response skips bytes and completion, including recovery when a previous completion response was lost. Mounting only restores state and makes no upload/API request. Switching the account/workspace remounts the bound component and prevents pending old callbacks from continuing to upload or navigate. The native worker separately owns file cleanup on account closure/discard.
- `src/components/receipt-review.tsx` now hydrates OCR fields once extraction is available after processing. Dirty fields preserve user corrections, later refreshes do not reset reviewed values, and receipt/account/workspace changes receive independent form state.
- Added independent tests `src/__tests__/upload-recovery.test.tsx` and `src/__tests__/receipt-hydration.test.tsx`, leaving the concurrently reviewed editor files untouched. Observed RED: receipt processing completion left merchant/amount blank; remount lost the selected upload in both expired-URL and lost-completion scenarios. GREEN: **2 suites / 6 tests passed**, covering fresh URL renewal, persisted file/stage identity, no automatic upload, lost create/completion response recovery, account/workspace isolation, late OCR hydration and correction retention.
- Final scoped verification: native `type-check`, ESLint on these four source/test files with `--max-warnings 0`, and Prettier passed. No new rendered-device or signed-storage transport verification is claimed.

## Privacy-safe operational health

`src/lib/operational-health.ts` exports `observeOperationalHealth(binding, request)`. It observes same-bound failed/blocked sync drafts and dedicated persisted recording/permission interruption counters. Native runtime integration and counter updates are owned by the native worker. Legacy paused sessions with known interruption errors are observed once; private error text never enters a report.

The durable `operational-health:<userId>` state holds at most 20 pending events and 100 local deduplication signatures. Failed requests retain event UUIDs; repeated observations reuse the queue, and events are removed only after `/me/health` returns `accepted: true`. A per-account single-flight guard avoids concurrent writes. The helper catches local/transport failures so capture and sync can proceed. Existing account purge recognizes the user-bound state key.

Every request is rebuilt and validated with shared `mobileHealthReportSchema`. The body contains only `{events:[{eventId,kind,reason,platform}]}`; account/workspace/draft/shift/file identifiers, client timestamps, errors, content, gig platforms and coordinates remain local. This also strips unexpected properties from previously persisted events. No analytics SDK or UI was added.

Verification: `src/__tests__/operational-health.test.ts` **7 tests passed**, covering the exact private-data allowlist, stable failed retry IDs, successful observation deduplication, wrong-binding rejection, queue/seen bounds, accepted-response requirement, swallowed storage errors, cached extra-field removal and concurrent observation serialization. Native type-check and scoped zero-warning ESLint passed.

## Canonical Home overview and widget freshness

`packages/contracts/src/business-income.ts` now contains the existing pure `consolidateBusinessIncome` calculation. The web dashboard file re-exports it, and the mobile dashboard API imports the same function: Books income is canonical when visible; without Books, paid invoices and Drive earnings are combined. Existing web invariant tests continue to exercise this shared implementation.

`src/app/api/v1/_lib/resources/overview.ts` returns a bound, typed `MobileHomeOverview` with at most four financial KPIs (total income, expenses, net income, outstanding invoices), a period label/currency, and actual attention counts for overdue/draft invoices, accepted quotes ready to invoice, and pending receipt reviews. Reads remain scoped to the requested workspace and installed modules/permissions. Pending receipt counts are fetched only for `manage:books`; quote attention uses the ready-to-invoice snapshot rather than the historical accepted count.

`apps/mobile/src/screens/tabs.tsx` renders the compact overview, filtered status links and five recent activity rows, with explicit empty states and the existing search/hAI/receipt/shift actions. A response from a different workspace or selected period cannot populate Home or its widget. An authoritative denial hides data and clears the existing widget snapshot.

`useResource` now exposes `syncedAt`: successful network reads set it, and offline fallbacks preserve the original cached reference timestamp (or the already displayed data's matching timestamp). Home passes that value to `updateOverviewWidget` alongside the canonical income/expenses and original period label; opening cached Home never changes a widget's freshness to now.

Observed RED: three API assertions failed because no canonical overview existed, and two resource assertions failed because freshness was undefined. GREEN: API/shared web calculation **6 Vitest tests**, Home/freshness/access-denial **7 Jest tests**, and the full mobile suite **12 suites / 53 tests** passed. Native and root TypeScript checks, scoped mobile/API/shared ESLint with zero warnings, and Prettier passed. Tests cover Books mirror deduplication, module/permission-filtered counts, original workspace reads, five-row activity limit, actionable filters, cached widget freshness, different-workspace rejection and denial clearing.

## Persistent private navigation toolbar

`apps/mobile/src/components/private-toolbar.tsx` adds `PrivateToolbar` and `PrivateAppFrame` without importing session state. `AppShell` supplies the verified workspace, current path, module/capability grants and navigation callback, and mounts the frame inside `AppLock`. `privateToolbarAllowed` requires the authenticated/bootstrap user and active/requested workspace bindings to match; public/auth/legal/invite routes and workspace onboarding never render it.

The compact toolbar shows the Soletrade mark, workspace switcher, Search, hAI and one clear contextual creation action. It uses existing native `@expo/ui` buttons with at least 44-point targets; content is capped at 820 points and respects top/landscape safe insets. The content navigator receives a zero top inset because the toolbar already consumes that safe area. The five native tabs and existing detail back navigation are unchanged.

`apps/mobile/src/lib/global-actions.ts` selects a supported form using `catalog`/`canWrite` plus installed-module checks: current resource first, Money→transaction, Drive→earning, Sales→invoice/quote/customer, then the first permitted creation. File upload requires `manage:file`; read-only roles have no create control. Search/hAI/workspace actions do not push another copy of their current route. No menu, package, plugin or native build change was added.

Verification: the new `global-actions.test.tsx` covers six contextual resource choices, module/permission denial, visible global actions and safe-area padding, workspace navigation, duplicate-route avoidance, form navigation and private-binding/public-route guards (**10 tests**). The full mobile suite passed **13 suites / 63 tests**; native type-check, scoped zero-warning ESLint and Prettier passed. Root owns final rendered phone/tablet inspection and JS export. SDK 58 references checked: [safe-area context](https://docs.expo.dev/versions/v58.0.0/sdk/safe-area-context/) and [Expo UI](https://docs.expo.dev/versions/v58.0.0/sdk/ui/).
