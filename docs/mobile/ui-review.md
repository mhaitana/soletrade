# Mobile integration review — 25 October 2026

Read-only code review of the approved plan, implementation reports, native screens, local persistence, shared transport and corresponding server adapters. No application code was changed. Findings describe the reviewed snapshot; concurrent implementation work may subsequently resolve them. This is not a rendered-screen or physical-device acceptance report.

## Findings: 3 P1, 5 P2

### 1. P1 — Google module changes start a new purchase without replacing current coverage

- Location: `apps/mobile/src/native/store-purchase.tsx:234–249`; eligibility: `src/platform/mobile/billing.ts:70–94`.
- Reproduce: own an active Google subscription for one module set, then select a different module set in the native catalog. Same-provider purchases are allowed, but the Google request contains only `skus`, account/profile IDs and `subscriptionOffers`.
- The request never obtains/passes the current purchase token or subscription replacement information. The other module set is a distinct Google subscription product, so this is submitted as a separate purchase rather than a change to the existing subscription. Backend replacement-chain handling cannot manufacture the missing Play purchase replacement request or prevent the initial extra store charge.
- Fix: obtain the original bound active purchase, supply `request.google.purchaseToken`, and configure the provider-approved replacement behavior with `subscriptionProductReplacementParams`. Installed `apps/mobile/node_modules/expo-iap/build/types.d.ts:1289–1321` explicitly declares `purchaseToken` for upgrades/downgrades and `subscriptionProductReplacementParams`; the older numeric `replacementMode` is deprecated. Reject a subscription change before launching the payment sheet when the current purchase cannot be resolved. Do not report success for deferred replacement before its effective entitlement is reflected.

### 2. P1 — Successful account deletion bypasses device purge

- Location: `apps/mobile/src/screens/tools.tsx:267–274`; cleanup exists only in `apps/mobile/src/lib/session.tsx`'s `ACCOUNT_CLOSED` failure listener.
- Reproduce: retain local drafts/receipt originals/private routes, reauthenticate, and successfully delete the account. `/me/deletion` returns success (`src/platform/mobile/account.ts:244–268`), and the screen calls ordinary `signOut` directly. Successful responses do not notify API failure listeners.
- Consequently the normal successful deletion path does not call `suspendShiftForLogout`, `purgeClosedAccountData`, `discardPrivateDeviceData`, or delete the account's SecureStore preferences. Cleanup currently depends on a coincidental subsequent rejected API request. This violates immediate device cleanup and can leave precise route/capture data behind after deletion.
- Fix: share an explicit closed-account cleanup routine between the successful deletion path and the `ACCOUNT_CLOSED` handler, suspending capture before purge and always clearing local authentication afterward.

### 3. P1 — A denied module request still displays its cached business records

- Location: `apps/mobile/src/lib/resources.ts:31–45`; server denial: `src/app/api/v1/_lib/authorization.ts:12` and `src/app/api/v1/_lib/resources/common.ts` `gate`.
- Reproduce: load an invoice/Books/Drive screen; disable that module elsewhere while the app retains its bootstrap; refresh the screen. The API returns `404 MODULE_UNAVAILABLE`. The hook only prevents cache fallback for 401/403, so it retains `previous.data` or loads the reference cache and displays the denied records.
- Fix: recognize explicit module/access denial codes independently of HTTP status, clear the affected view/cache, and refresh bootstrap. Keep offline fallback limited to actual availability failures.

### 4. P2 — Every vehicle-expense edit fails strict request validation

- Location: `apps/mobile/src/lib/catalog.ts:148–166`, `apps/mobile/src/screens/editor.tsx:119–123`; server: `src/app/api/v1/_lib/resources/drive.ts:305`.
- Reproduce: open an existing Drive vehicle expense, change its description, Save. `formBody` always includes the catalog's required `vehicleId`, while PATCH validates with `expenseSchema.omit({ vehicleId: true }).partial()` and the schema remains strict. Even an unchanged vehicle produces an unknown-key error.
- Fix: use an edit-specific body that omits immutable `vehicleId`, and render the vehicle as read-only during editing; or deliberately implement supported vehicle reassignment in the server/domain contract.

### 5. P2 — Ownership transfer has no valid member option

- Location: `apps/mobile/src/screens/editor.tsx:46–48`, used by `apps/mobile/src/screens/tools.tsx:307–320`; response shape: `src/platform/members/index.ts:17–24,46–53`.
- Reproduce: owner opens Privacy and account → Transfer workspace ownership. `ReferenceField` labels from `name/description/id` and sets values from `entity.id`. Members instead expose `memberId`, `userId`, and `email`; no `id` or `name` exists. Options therefore have the label `undefined` and undefined values, so a valid `toUserId` cannot be selected.
- Fix: supply resource-aware identity/label mapping (`userId`, `email` for members), and exclude the current owner from transfer recipients.

### 6. P2 — Reference selectors cannot reach records beyond the first 30

- Location: `apps/mobile/src/screens/editor.tsx:36–50`; pagination default: `src/app/api/v1/_lib/resources/common.ts` `querySchema.limit`.
- Reproduce: have more than 30 customers and create an invoice/quote for a customer outside the first API page. `ReferenceField` requests the bare collection once, ignores `nextCursor`, and offers no search/load-more control. That customer cannot be selected. The same limitation applies to vehicle and member references.
- Fix: add a searchable paginated reference selector and hydrate the currently selected reference independently of the current page. Merely raising the limit leaves the same failure at another collection size.

### 7. P2 — Parking/tolls expense options cannot be saved or filtered

- Location: `apps/mobile/src/lib/catalog.ts:158`; server: `src/app/api/v1/_lib/resources/drive.ts` `expenseType` enum.
- Reproduce: choose Parking or Tolls when creating a vehicle expense and Save. Mobile offers both strings but the server only accepts `fuel`, `maintenance`, `insurance`, `registration`, `other`. The create is rejected; the editor returns to the previous screen with an immutable queued draft, and Drafts only permits retry/discard. Choosing either list filter also sends an invalid enum.
- Fix: align the picker/filter options with the authoritative supported domain values, or implement the additional values across schema/domain/storage. Give definitively rejected drafts a correction flow rather than retrying the same invalid body indefinitely.

### 8. P2 — Widget/internal link destination is lost during sign-in

- Location: `apps/mobile/src/screens/shell.tsx:45–47`; `apps/mobile/src/screens/auth.tsx` `SignInScreen` destination validation.
- Reproduce: while signed out, open `soletrade://feature/receipt`, `soletrade://feature/shift`, or `soletrade://edit/invoices/new` from a static widget/shortcut URL. The shell replaces the destination with `/sign-in` without retaining it. Sign-in only accepts invitation return paths and otherwise routes home, so the requested action is never resumed.
- Fix: retain a strictly allowlisted pending internal destination (plus original binding where applicable), carry it through password/email authentication and workspace selection, then recheck membership/module/permission before consuming it once.

## Verification/provisioning still required — not code findings

No simulator/physical rendering, screenshots, store sandbox purchases, real push/GPS/widget behavior, configured database migrations, live OCR/email/storage/AI flows, or signed native build was exercised by this review. Existing successful bundles and automated checks do not establish those results. The device/UI reports already enumerate these release gates. The concurrent root fixes for streamed-turn claims, SQL concurrency, server replacement-token ordering, and schema/account purge were not counted as additional findings here.

## Remediation status

The eight original findings have been addressed. A second read-only pass confirmed the corresponding code fixes and identified edit-snapshot refresh, expired upload URLs, receipt currency and late OCR hydration issues. Those are now addressed with targeted regression coverage in `ui-review-fixes.md`. The controller preserved the original edit snapshot/version across refetches and keeps document forms mounted until explicit navigation or authorization denial.

The later committed-PUT/lost-response recovery issue is also fixed in the backend: upload initiation/renewal reconciles storage size/MIME and completes valid existing bytes rather than attempting a duplicate upload. Storage outages and mismatches fail closed.

Home now uses the web's shared canonical income calculation and actual follow-up/activity data; cached widgets keep the original sync time and clear on explicit access denial. The implementation ledger records the final combined checks. Physical-device, store and staging acceptance remain separate gates.
