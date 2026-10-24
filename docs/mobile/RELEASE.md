# Mobile setup and release gates

The native client lives in `apps/mobile`; the root Next.js app remains its backend. Store purchases are disabled until verification credentials and the store catalogue are configured. No production database or store submission is performed by installing this code.

## Local development

1. Install workspace dependencies with `pnpm install`.
2. Apply the additive mobile migrations to a **local or staging** Supabase database using the normal project migration workflow. Do not reset a database containing needed data. The embedded PostgreSQL tests exercise the complete migration chain without Docker.
3. Keep the existing server environment and merge the applicable keys from `docs/mobile/server.env.example`. Start Next.js with `pnpm dev`.
4. Create `apps/mobile/.env.local` from its example and set the API origin plus the same Supabase project's public URL and publishable/anon key. A phone must use a reachable HTTPS development/staging origin; loopback URLs refer to that phone, not the development computer.
5. Use `pnpm mobile:dev` with a native development build. Run `pnpm --dir apps/mobile ios` or `android` for a local native build. Widgets, purchases and push require the configured native binary.

Allow the native callback `soletrade://auth/callback` in Supabase Auth redirect settings. Configure public invoice, quote and invitation links to retain browser fallback. Review native email-link delivery and production associated/universal links before release.

## Store and device configuration

- App identifier: `au.com.soletrade.business`; URL scheme: `soletrade`.
- Create the 15 module-set monthly/annual offers using `/api/v1/billing/store/catalog` as the identifier/target-price inventory. Display actual localized store prices, not calculated target prices. Apple uses one subscription group; Google uses base plans. Store price targets include the agreed 20% web-price uplift.
- Configure Apple Server Notifications at `/api/v1/webhooks/apple`; configure authenticated Google Pub/Sub notifications at `/api/v1/webhooks/google`. Supply trusted Apple PKI roots and production app ID; never disable signature verification.
- Bind an EAS project and configure APNs/FCM credentials for push. Keep `/api/cron/mobile` running every minute for durable notification delivery, store reconciliation and due account purges. Monitor failed/uncertain jobs rather than assuming a successful HTTP request proves device delivery.
- Connect server log collection and alerts to `Mobile job health`, `Store reconciliation failed`, `Account purge remains pending` and `Mobile device health`. The cron returns aggregate counts for failed/uncertain push work, failed billing events, overdue purges and unresolved non-stream operations. Assistant stream claims remain reserved intentionally; their individual write operations are included in the unresolved-operation count. Device reports retain event UUIDs across retry; deduplicate log events by that UUID. Reports contain only an allowlisted event kind, reason and operating system. Configure alert thresholds and retention in the deployment's log collector before release.
- Configure an Android Maps API key for map tiles where required; precise route records remain private regardless of map rendering. iOS uses Apple Maps.
- Build app/widget signing targets and test the custom Android quick-action widget on a launcher. Quick actions open native screens and never begin GPS recording without the user's action.

## Acceptance before public release

- Run `pnpm check`, `pnpm mobile:type-check`, `pnpm --filter @soletrade/mobile lint`, `pnpm mobile:test`, and both native production bundle exports.
- Test complete web/native flows against staging: passwords/email links/invites, multi-workspace permissions, invoice/quote lifecycle and public pages, actual file upload/download, OCR review, Books mirrors/reports/tax, Drive, team/settings, hAI streaming and tool confirmation.
- Exercise authored Maestro journeys and expand the device run to lost-response/offline replay, revoked access/module, account deletion and private-route sync/deletion across two devices.
- Test GPS with foreground/background, screen lock, pauses, permission changes, process termination/relaunch and long shifts on physical iOS and Android devices. Recording gaps must be visible; force-stop survival is not promised.
- Use Apple/Google sandbox accounts to verify purchase, pending payment, upgrade, deferred downgrade, interval change, replacement token, restoration, renewal, grace, refund/revocation and late notification ordering. Confirm no second provider bills an already-covered workspace.
- Exercise Apple billing retry and Google account hold/pause: module access is suspended, while the original provider keeps billing authority until it confirms an ended state. Recovery restores the same verified chain; unknown provider states fail closed. The app directs the purchaser to manage the original store payment before starting another subscription.
- Test purchase reservations on two devices before either store response arrives. Uncertain or pending attempts retain their original reservation without automatic expiry; restore the original purchase instead of opening another sheet. Only a confirmed store cancellation releases an unfulfilled reservation. Store purchases remain bound to the purchaser's original workspace across providers; additional workspaces use web billing. Document a support recovery procedure for unresolved provider states before enabling purchases.
- Verify push categories/quiet hours, dead-token receipts, widgets/shortcuts, biometrics, cameras, sharing, large text, dark mode, reduced motion and tablet layouts on physical devices.
- Review the updated privacy/terms text and store privacy/data-safety declarations. Use `/delete-account` as the public deletion entry point.
- Complete TestFlight and closed Google Play testing. Publish in Australia only after all feature-parity and device/store gates pass.

`docs/mobile/IMPLEMENTATION.md` records verification actually performed in this workspace. Build and unit-test success do not substitute for physical-device, store-sandbox or staging parity acceptance.
