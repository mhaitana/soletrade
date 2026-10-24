# Soletrade mobile implementation

The implementation is on `feat/native-mobile`. The original workspace was clean. No production migration, deployment, store configuration, purchase or store submission has been performed.

Approved scope: [implementation plan](../superpowers/plans/2026-10-25-soletrade-mobile.md). Setup, credentials and release acceptance: [RELEASE.md](RELEASE.md). Native development: [app README](../../apps/mobile/README.md).

## Delivered software

- [x] Versioned Next.js HTTP API, shared platform-safe contracts, verified native bearer sessions, explicit workspace/role/module guards and bootstrap.
- [x] Durable operation identities, replay authorization, deterministic creation, atomic stale-edit checks and receipt application. Existing cookie-based web flows retain their service interfaces.
- [x] Expo SDK 58 application, native navigation, account/workspace flows, warm neutral/blue light and dark themes, readable tablet widths and accessible native controls.
- [x] Sales, Money, Drive, shared tools, profile/settings/team, billing and hAI screens backed by real business adapters.
- [x] SQLite drafts/outbox, durable receipt/file capture, reviewed OCR, GPS shifts/gaps/recovery, private optional route sync, sharing, biometric lock, notifications, shortcuts and widgets.
- [x] Provider-neutral billing, Stripe contract backfill/compatibility, all 30 native offers, native purchase verification/notifications and durable purchase reservations.
- [x] Ownership transfer, immediate account access revocation, due deletion/storage purge, public deletion entry and privacy/terms updates.
- [x] Operational monitoring using strict private-data-free device events and aggregate durable-job counters.
- [x] Independent backend/native integration reviews and regression fixes.
- [ ] Staging workflow acceptance against the web feature inventory.
- [ ] Physical iOS/Android capability acceptance and store sandbox billing acceptance.
- [ ] TestFlight, closed Google Play testing and Australian public release.

These boxes describe delivered code, separately from release acceptance. Public release remains gated on the unchecked work.

## Feature entry points

| Area | Native implementation | Backend |
| --- | --- | --- |
| Home | `screens/tabs.tsx`: compact canonical totals, real follow-ups, recent activity and capture/shift actions | `api/v1/_lib/resources/overview.ts`; shared `contracts/business-income.ts` retains the web's Books-first income calculation |
| Sales | `screens/editor.tsx`, `resources.tsx`: customers/timelines, document lines/tax/payment instructions, lifecycle, signatures, PDFs and conversion | `resources/sales.ts`, `documents.ts`; existing domain services |
| Money | Transactions/categories/GST, receipt review, tax snapshots, charts, reports and exports | `resources/books.ts`; atomic application and source-linked edit restrictions |
| Drive | Earnings, vehicles/expenses/manual mileage, native shift review, settings and exports | `resources/drive.ts`; reviewed shift creates one deterministic mileage record |
| More | Files, activity/audit/inbox, search, hAI, billing, modules, profile, settings and team | `resources/platform.ts`, `assistant.ts`; account and billing adapters |
| Device features | `src/native`, `src/offline` | `platform/mobile/account.ts`, `push.ts`, `billing.ts`, `store-events.ts`, `jobs.ts` |

## Integrity decisions

Drafts, captures, recording sessions, uploads and queued operations retain their original account/workspace. New captures/drafts save locally; explicit Save queues eligible creates. Existing financial edits, sends, payments, conversions, tax lodging, OCR, hAI and billing require connectivity. Pending device work never enters authoritative financial totals.

Uncertain external operations are retained for recovery rather than executed again. Definitively rejected new drafts can be corrected with their original attachment/binding identity. Existing edits use the version of the form's original snapshot; a background refresh cannot silently adopt a newer write token or discard unsaved document lines.

Upload recovery reconciles real stored bytes against expected size/MIME, including a committed PUT whose response was lost. OCR preclaims processing before charging, and receipt application/mirror creation is atomic. Completed operation replay rechecks current authorization.

Store purchases reserve purchaser and workspace before the payment sheet. Pending or uncertain outcomes have no automatic expiry. A returned reservation from another attempt and an already-launched local intent use restoration rather than opening a second sheet. Only confirmed native cancellation releases an unfulfilled reservation; server verification consumes it atomically. The original store-funded workspace remains fixed across provider history. Verified provider state, not client selections or pending downgrade metadata, controls module access.

Precise routes stay private to their recorder; syncing defaults off. Device reports contain only a random event ID, an allowlisted event kind/reason and iOS/Android. No coordinates, content, account/workspace/record identifiers, client timestamps or free-form errors are transmitted by this reporting path. The server emits aggregate job counts and allowlisted error metadata.

## Verification record

The root controller records final command results here after all workers freeze. Detailed earlier RED/GREEN evidence is retained in the implementation/review reports; earlier counts describe their respective checkpoints.

- Backend/shared tests include embedded PostgreSQL execution of every repository migration, actual billing/ownership/purge/receipt/idempotency constraints and device/offline policy tests.
- Native Jest covers transport/forms, edit snapshot preservation, failed save recovery, bound upload recovery, OCR hydration, navigation, cache denial/freshness, Home and private operational reports.
- The 217 database-dependent tests skipped without a running Supabase database were also skipped at the initial baseline. Embedded PostgreSQL tests run independently; skipped real-Supabase tests still require staging/local-stack execution.
- Both iOS and Android Hermes production bundles are exported. This proves JavaScript bundling, independently of signed binary/device behavior.
- A local iOS simulator native build, installation and sign-in render were verified. Exact final dependency/build status is recorded below.
- Authenticated Maestro journeys are authored in `apps/mobile/maestro`; they require a configured test backend/account and have not been executed here.

## External release gates

Store purchases stay disabled until real product/offer configuration and server verification credentials are supplied. Configure EAS/signing, APNs/FCM, map keys, email callbacks/universal links and server jobs using `RELEASE.md`.

Exercise real OCR/storage/email/AI integrations, all customer workflows and web regressions on staging. Test background GPS, lock/termination/recovery, revoked permissions, two-device route deletion, notification receipts/quiet hours, widget cold launch/privacy, cameras/sharing/biometrics, Dynamic Type/VoiceOver/TalkBack and tablet layouts on physical devices. Complete store sandbox renewal/refund/grace/deferred-change/pending-payment/restoration/concurrent-purchase cases.

Privacy/terms and store disclosures require release review. Optional Android gig-app opening detection remains deferred until physical feasibility validation; explicit Start/Stop and manual mileage are implemented.

## Final native build evidence

The final SDK 58 iOS Debug simulator app, including SystemUI 58.0.6, Notifications 58.1.6, widget target, maps, purchases and quick actions, built successfully, installed and launched on an iPhone 17 Pro / iOS 26.5 simulator. Debug symbol generation was disabled for the final local verification build to reduce disk use. Generated Xcode build caches were cleared after installation. This is simulator build/startup evidence; authenticated staging flows and physical-device behavior remain unchecked.

The final Android project prebuild passed. Its bounded ARM64 Gradle assemble installed the required SDK 37 tooling and compiled Worklets Kotlin/Java, but stopped above the disk safety floor before an APK was produced. No application source compiler error was reported. Full Android binary verification remains outstanding; the isolated Android widget Kotlin/resource checks and successful Android Hermes bundle do not substitute for it.

Optional gig-app launching is implemented through verified build configuration (`EXPO_PUBLIC_GIG_APP_LINKS_JSON`, default `{}`). Only configured safe links are exposed; shift persistence precedes launch, failure keeps recording active, and no online-status inference or tracking data is appended. Provider-owned links still need OS/device validation before enabling them in a release.

## Final combined verification

| Check | Observed result |
| --- | --- |
| `pnpm check` | Exit 0: root TypeScript, ESLint, **912 passing tests / 217 skipped** across 106 passing / 29 skipped files, and repository Prettier check |
| `pnpm --dir apps/mobile check` | Exit 0: native TypeScript, Expo ESLint, **71 passing Jest tests** across 15 suites |
| `pnpm build` | Exit 0: final integrated Next.js production build, including versioned API and public deletion route |
| Expo export for iOS and Android | Exit 0: both final Hermes bundles exported (approximately 5 MB each) |
| Online `expo install --check` | Exit 0: dependencies up to date |
| iOS native Debug build | Final dependency set built successfully; simulator install and app launch verified |
| Android prebuild/widget compilation | Prebuild and isolated widget resources/Kotlin passed; full APK stopped at the machine's disk headroom limit |
| `git diff --check` | Passed |

The database-dependent skips match the initial baseline's 217 skips. No authenticated staging/physical-device journey, live purchase, live push, production migration or deployment is included in these results.

Final review follow-up verified the atomic conversion implementation without additional blockers. The last capture recovery finding—completed standalone uploads being mistaken for orphan receipts—was fixed with journal retirement before upload-state removal, stable journal upload identities, and filesystem/UI ordering regressions. Recovery does not queue guessed financial records. Source changes are maintained on `feat/native-mobile`.

## Local testing follow-up

Docker and the existing local Supabase database were restored without resetting data. The three mobile migrations were applied locally after a database backup. Soletrade uses dedicated API/database/Studio/mail ports 56421/56422/56423/56424 to avoid other local projects; ignored server and native environments use these local connections. Demo bearer sign-in, bootstrap and customer-facing read APIs were checked over the LAN.

The Money/Drive summaries and dated lists now retain their date cutoff during loading and advance it only on period changes or explicit refresh. Raw whitespace children were removed from native view containers. Regression checks reproduced both the unstable request URLs and native text invariant before their fixes. The final mobile check passes 71 tests across 15 suites, and Money, Drive, Sales and the mileage list render in the iOS simulator without new runtime errors. This local evidence does not replace staging, physical-device or store acceptance.
