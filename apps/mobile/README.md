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

- `src/app/` contains route entrypoints and layouts only. Home / Sales / Money / Drive / More are native tabs with SF/Material icon counterparts.
- `src/lib/session.tsx`: `SessionProvider` / `useSession`, SecureStore-backed Supabase sessions, PKCE/OTP callbacks, token refresh, workspace selection, cached bootstrap and account-bound `MobileRequest`.
- `src/lib/api.ts`: bearer requests, `{data}` / `{error}` envelopes, UUID idempotency and `If-Match`, binary/stream transport, authorization failure notifications.
- `src/lib/resources.ts`: workspace-bound data loading and SQLite reference cache; cached content coexists with transient refresh failures. Authorization failures never restore cached data.
- `src/screens/editor.tsx`: human-labelled resource forms and structured invoices/quotes. Explicit Save is the creation boundary; new offline-capable records go through the durable outbox even when online. Server-linked Books mirrors are read only.
- `src/screens/resources.tsx`: paginated lists, filters, customer history, document lifecycle, files and sharing. `screens/tools.tsx`: search, reports, BAS, transfers and account closure. `screens/assistant.tsx`: persistent SSE conversations and reviewed native form/navigation directives.
- `src/native/` and `src/offline/`: receipt capture/OCR review, durable uploads/outbox, shifts, private GPS routes, notifications, biometric lock, widgets in-app purchases, private route maps and account/workspace-bound app shortcuts. See `docs/mobile/device-report.md` for their verification limits.
- `src/theme/` and `src/components/ui.tsx`: warm neutral / blue light-dark tokens, scalable type, accessible native `@expo/ui` buttons, pickers and toggles. More uses native grouped forms.

## Verify

```sh
pnpm --dir apps/mobile type-check
pnpm --dir apps/mobile lint
pnpm --dir apps/mobile test
pnpm exec vitest run apps/mobile/src/offline apps/mobile/src/native
pnpm --dir apps/mobile exec expo export --platform ios --platform android
```

Jest runs the UI/transport tests; the root Vitest runner owns device/offline policy tests. `maestro/` contains four native journeys for a configured development build. Run with a seeded confirmed account, active modules and appropriate owner/member roles:

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
