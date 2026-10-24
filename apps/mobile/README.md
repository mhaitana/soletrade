# Soletrade native app

Expo SDK 58 / React Native 0.88 / Expo Router. The existing Next.js server owns business data and permission checks; the native app uses `/api/v1` with verified Supabase bearer sessions. No service role key belongs in this app.

## Run locally

1. Use Node 22.13+ within the 22.x line, or Node 24+, for Testing Library 14. From the repository root run `pnpm install` (the workspace lockfile pins native peers independently from the web app).
2. Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` (`.env` is also supported) and set the public API origin, Supabase project URL and public anon/publishable key manually. Use the server origin without `/api/v1`. For the local stack, Next.js uses port **3000** and Supabase API/Auth uses **56421**; Postgres, Studio and the development email inbox use **56422**, **56423** and **56424**. Obtain the public Supabase values from `supabase status`. A physical phone must reach both origins over your machine's LAN address; `localhost` on a phone points to the phone.
3. Apply the repository's mobile database migrations and configure the server-side storage, email, AI and store providers described in `docs/mobile/`. Use a nonproduction workspace for verification.
4. Add `soletrade://auth/callback` to Supabase Auth redirect allowlists. Email templates must preserve the PKCE `code` or `token_hash`. The client also accepts implicit session fragments for compatibility. Configure universal links and app-site association files for a production HTTPS invitation domain before release.
5. Build a native development client with `pnpm --dir apps/mobile ios` / `android`, then run `pnpm --dir apps/mobile start --lan --port 8083` to start Metro on the current dedicated port. The app includes native UI, purchases, background capabilities and custom widgets, so use a development build for development and verification.
6. For EAS, run `eas login`, `eas init` from this directory and set `extra.eas.projectId` in app config. Register the real bundle/package IDs, signing credentials and provisioning capabilities. `eas.json` includes development, internal preview and production profiles. No EAS project or store listing has been provisioned by this change.

## Architecture

- `src/app/` contains Expo Router route entrypoints and layouts only. Route paths, app links, native tabs and modal presentation stay stable.
- `src/application/` composes session lifecycle, native startup, account cleanup, navigation and feature screens. The root provider registers background shift tasks at module scope.
- `src/features/` owns auth, account, assistant, overview, sales, books, drive, billing, records, files, receipts, search, reporting, tax and device settings. Each feature contains its screens, components and private policies beside their tests.
- `src/features/records/` is the shared generic list/detail/editor feature; other features use common reference fields and record displays from `src/components/`, without importing its screen internals.
- `src/lib/` owns API transport, the session context, resource fetching, sharing and device/offline adapters. `src/config/resources.ts` describes common resource fields and permissions.
- `src/lib/offline/` preserves account/workspace-bound durable outbox and cached-reference storage. `src/lib/native/` owns background shifts, widgets, notifications and device adapters; feature screens remain under their owning feature.
- `src/components/`, `src/theme/` and `src/hooks/` (when needed) hold app-wide UI primitives and theme behavior. Shared runtime contracts are consumed through `@soletrade/contracts`; mobile never imports web source.
- Features can depend on their own internals and app-wide primitives. Application composition can depend on all features. Shared layers cannot depend on application or feature code.

## Verify

```sh
pnpm --dir apps/mobile type-check
pnpm --dir apps/mobile lint
pnpm --dir apps/mobile test
pnpm --dir apps/mobile test:ui
pnpm --dir apps/mobile test:unit
pnpm --dir apps/mobile exec expo export --platform ios --platform android
```

Jest runs UI/transport tests; the mobile-owned Vitest runner runs `*.vitest.test.ts` device/offline policy tests. The two runners have disjoint discovery patterns. `maestro/` contains four native journeys for a configured development build. Run with a seeded confirmed account, active modules and appropriate owner/member roles:

```sh
maestro test -e EMAIL=qa@example.com -e PASSWORD='your-test-password' apps/mobile/maestro/01-auth.yaml
maestro test -e EMAIL=qa@example.com -e PASSWORD='your-test-password' apps/mobile/maestro/02-customer.yaml
maestro test -e EMAIL=qa@example.com -e PASSWORD='your-test-password' apps/mobile/maestro/03-navigation.yaml
```

These journeys are authored but have not been executed against a device in this session. Validate large text, VoiceOver/TalkBack, both themes, tablet widths, denied permissions, airplane-mode capture/restart/replay, stale edits and account/workspace revocation. Exercise real email callbacks, storage uploads, PDFs, sends, AI streaming and BAS against the configured server. Background GPS, push, biometric lock, widget cold launches and Apple/Google purchase/restore/refund flows require physical devices and store sandboxes before release. JavaScript export does not prove a signed native application installs or native capabilities work.


## Optional gig-app launch links

`EXPO_PUBLIC_GIG_APP_LINKS_JSON` defaults to `{}`. Manual Start/Pause/Resume/Stop always works. To enable optional app launch, supply a JSON object mapping the supported gig platform IDs to provider-owned native or HTTPS app links, verified by your team for that OS/build. EAS profiles may provide different values on iOS and Android. No built-in Uber/driver or other provider scheme is assumed to be verified.

The app accepts only explicit links without credentials, query parameters or fragments and rejects dangerous/system-action schemes. It never appends coordinates, recording status, vehicle data or other tracking payloads. The shift is durably started before opening the selected link; launch failures leave recording active and instruct the user to switch apps manually. An active shift also exposes an Open app action when a valid link is configured.

Before release, verify ownership/documentation for every configured provider link and test actual cold/warm launches on both physical operating systems, including app-not-installed and denied-launch behavior. Configuration is not proof of provider support. Keep `{}` and manual switching when no authoritative link is available.
