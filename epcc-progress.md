# EPCC Progress Log

## Session: EXPLORE - 2026-07-20T11:30:00Z
**Target**: Invoice email delivery in production (send-invoice modal, Resend wiring)
**Thoroughness**: medium
**Duration**: ~12 minutes

### Areas Explored
- Invoice send flow from UI (`invoice-detail-actions.tsx`) through Server Action (`actions.ts`) to `sendInvoice()` service
- Event bus wiring in `src/instrumentation.ts` and `registerNotifications()`
- Resend email client (`src/server/email/index.ts`) and notification handlers (`src/platform/notifications/index.ts`)
- Invoice email template and public-token link construction
- Environment variable requirements and production `.env.prod` presence
- Existing tests covering email no-op / success / failure behavior

### Key Patterns Found
- Best-effort email: `sendEmail()` never throws; missing env → `not-configured`, API failure → `send-failed`, both logged only
- Send-invoice dialog stays open on success because `run()` never clears `pending` state
- Dialog copy still says "No email is sent in this phase" despite email being implemented

### Files Examined
~14 files including `src/instrumentation.ts`, `src/server/email/index.ts`, `src/platform/notifications/index.ts`, `src/platform/notifications/templates.ts`, `src/modules/invoices/index.ts`, `src/app/(app)/invoices/actions.ts`, `src/app/(app)/invoices/invoice-detail-actions.tsx`, `src/shared/lib/env.ts`, `.env.example`, `.env.prod`, plus tests and docs.

### Handoff Notes
- Ready for: PLAN phase to decide UI fix scope (close modal + update copy + optional toast/delivery feedback)
- Blockers: none
- Follow-up: verify Vercel production env values and Resend domain verification status

### Git State
- Commit: 9973aaa
- Branch: main
- Clean: no (deleted `epcc-features.json`)

---

## Session: PLAN - 2026-07-20T11:45:00Z
**Target**: fix-invoice-send-modal-and-email-feedback
**Effort**: ~2h
**Complexity**: Simple

### Summary
Created a focused UI/UX fix plan: update the stale send-dialog copy, close the dialog on success, and show a `sonner` toast. Kept the scope narrow — actual Resend delivery debugging remains a separate operational follow-up.

### Approach
- Reuse existing `sonner`/`Toaster` setup.
- Follow the project's adjust-during-render close pattern if needed.
- Add a component-level test since there is no existing `invoice-detail-actions.test.tsx`.

### Tasks
1. Update send-dialog copy.
2. Close dialog + show toast on success.
3. Add component test.
4. Run type-check / lint / test:ci.

### Risks
- Existing tests/timing assumptions (low).
- Adjust-during-render warning (low; follow existing pattern).

### Out of Scope
- Server Action return-type changes.
- Resend domain/queue operational debugging.

### Git State
- Commit: 9973aaa
- Branch: main
- Clean: no (deleted `epcc-features.json`)

---

## Session: CODE - 2026-07-20T11:55:00Z
**Target**: fix-invoice-send-modal-and-email-feedback
**Mode**: default
**Status**: Complete

### Summary
Implemented the planned UI/UX fix. The Send-invoice dialog now closes on success, the description tells the user an email is sent, and a `sonner` toast confirms the action. Added component-level tests.

### Files Modified
- `src/app/(app)/invoices/invoice-detail-actions.tsx` — updated copy, added toast + dialog close on success.
- `src/app/(app)/invoices/invoice-detail-actions.test.tsx` — new test file (3 tests).
- `EPCC_CODE.md` — implementation notes.

### Quality Metrics
- `pnpm type-check`: clean
- `pnpm lint`: clean
- `pnpm test:ci`: 80 files, 726 tests passed

### Checkpoint Commit
Pending — run `/epcc-commit`.

### Handoff Notes
**Resume at**: `/epcc-commit` to save the verified change.
**Blockers**: None.
**Next action**: Commit the implementation files + EPCC docs.
