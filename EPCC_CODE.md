# Implementation: fix-invoice-send-modal-and-email-feedback

**Mode**: default | **Date**: 2026-07-20 | **Status**: Complete

## 1. Changes (2 files)

**Modified**: `src/app/(app)/invoices/invoice-detail-actions.tsx`
- Imported `toast` from `sonner`.
- Updated the Send-dialog description from *"No email is sent in this phase"* to *"This locks the invoice, creates a public payment link, and emails the customer a payable link."*
- On a successful action, `setPending(null)` now closes the confirmation dialog immediately, and a `toast.success("Invoice sent.")` appears for the `send` action.

**Created**: `src/app/(app)/invoices/invoice-detail-actions.test.tsx`
- New component test suite (3 tests) covering:
  - Dialog opens and shows the updated email copy.
  - Confirming Send closes the dialog, calls the action, toasts, and refreshes the route.
  - A failed send keeps the dialog open, displays the error, and does not toast.

## 2. Quality

**Tests**: 80 test files passed, 726 tests passed (including the 3 new component tests).
**Type-check**: clean (`tsc --noEmit`).
**Lint**: clean after removing an unused `Mock` import.

## 3. Decisions

- **Client-side toast instead of Server Action status plumbing**: Kept the change minimal and aligned with the existing architecture where email delivery is best-effort. The toast confirms the invoice transition + `InvoiceSent` event publish, not Resend acceptance.
- **Close dialog inline inside `startTransition`**: The success callback already runs inside a transition; clearing `pending` there is the natural place and matches how the component controls dialog state elsewhere.

## 4. Handoff

**Run**: `/epcc-commit` when ready.
**Blockers**: None.
**TODOs**: Investigate production Resend delivery separately (Vercel env + Resend domain verification checklist in `EPCC_EXPLORE.md`).
