# Exploration: Invoice email delivery in production

**Date**: 2026-07-20 | **Scope**: Medium | **Status**: ✅ Complete

## 1. Foundation (What exists)

**Tech stack**: Next.js 16 (App Router) + React 19, TypeScript strict, Supabase JS (PostgREST), Resend (`resend`), Tailwind v4, Vitest.

**Invoice email architecture**:
- `src/modules/invoices/index.ts:621-650` — `sendInvoice()` transitions an invoice to `sent`, generates a `publicToken`, fetches the customer/email context, and publishes an `InvoiceSent` event on the in-process event bus.
- `src/instrumentation.ts:45-47` — server bootstrap calls `registerNotifications()` once, wiring event-bus subscribers.
- `src/platform/notifications/index.ts:47-63` — `onInvoiceSent` receives the event, coerces metadata, renders the email with `invoiceSentEmail()`, attaches a best-effort PDF, and calls `sendEmail()`.
- `src/platform/notifications/templates.ts:115-143` — pure template that produces subject `"Invoice <number>"`, HTML/text body, and a pay link built from `NEXT_PUBLIC_APP_URL`/i/<publicToken>.
- `src/server/email/index.ts:44-99` — thin `Resend` wrapper. `getEmailClient()` returns `null` when `RESEND_API_KEY` or `EMAIL_FROM` is missing; `sendEmail()` never throws — it logs and returns `{ ok: false, reason: "not-configured" | "send-failed" }`.

**UI trigger**:
- `src/app/(app)/invoices/invoice-detail-actions.tsx` — the **Send** button opens a confirmation dialog; on confirm it calls `sendInvoiceAction()` and then `router.refresh()`.
- `src/app/(app)/invoices/actions.ts:194-207` — the Server Action authorizes the user, calls `sendInvoice()`, revalidates paths, and returns `{ ok: true }`.

## 2. Patterns (How it's built)

**Best-effort, fire-and-forget email**: Email is intentionally decoupled from the action result. The Server Action returns success as soon as the invoice transitions and the event is published; whether Resend actually accepts/delivers the message is logged but not surfaced to the user. This matches the design in `src/server/email/index.ts:8-15` and the test at `src/server/email/index.test.ts:13-22`.

**Event bus as the seam**: `InvoiceSent` carries all render data (`publicToken`, `customerEmail`, `customerName`, `totalCents`, `currency`, etc.) so `src/platform/notifications` never imports `@/modules/invoices`.

**Controlled dialog without explicit close**: The dialog open state is driven by `pending !== null` (`src/app/(app)/invoices/invoice-detail-actions.tsx:142`). The success path in `run()` (`lines 66-82`) only calls `router.refresh()`; it never sets `pending` back to `null`, so the dialog stays open after a successful send.

**Stale dialog copy**: `DIALOG_COPY.send.description` (`src/app/(app)/invoices/invoice-detail-actions.tsx:26-31`) still says *"No email is sent in this phase"*, even though Phase 5c/Wave 4 implemented email delivery.

## 3. Constraints (What limits decisions)

**Environment requirements for live email**:
- `RESEND_API_KEY` and `EMAIL_FROM` must be set in the runtime environment (`.env.prod` has values configured, but the deployed Vercel project must also have them). `src/shared/lib/env.ts:71-72` validates them as optional strings; empty strings are treated as unset.
- `NEXT_PUBLIC_APP_URL` must be the real production domain; otherwise the pay link in the email points to `localhost`/`vercel.app`/wrong host.
- Resend requires the sending domain to be verified. An unverified `EMAIL_FROM` domain will cause Resend to reject/queue-drop mail, returning an API error that is logged but not shown in the UI.

**Data requirements**:
- `customerEmail` must be non-null. Walk-in customers (no customer row or no email) result in a no-op email send (`src/platform/notifications/index.ts:49`). The UI labels these as "Walk-in customer".

**Observability constraints**:
- Email failures only appear in server logs (`console.error` / `console.warn`). There is no in-app toast, banner, or notification status page showing whether an email was accepted by Resend.

## 4. Reusability (What to leverage)

**Existing patterns to follow if fixing this**:
- `src/app/layout.tsx` already mounts `<Toaster />` from `@/shared/ui/sonner`, so `toast.success()`/`toast.error()` can be used for action feedback (`src/app/(admin)/admin/promotions/create-promotion-dialog.tsx:5` shows an existing usage).
- The Server Action can return richer result shapes (e.g., `{ ok: true, emailed: boolean, reason?: string }`) without breaking the current `{ ok: boolean }` contract if the client is updated.
- `sendEmail()` already returns a typed `SendResult`; the notification handler could forward the result, or the action could await the event publish and inspect email status.

## 5. Handoff (What's next)

**Most likely user-facing issue ("modal stayed")**:
The Send-invoice dialog does not close on success. Two small UI fixes are needed:
1. In `src/app/(app)/invoices/invoice-detail-actions.tsx` `run()`, set `setPending(null)` on success before/after `router.refresh()`.
2. Update the `send` dialog description to reflect that an email is sent, e.g., *"This locks the invoice, creates a public payment link, and emails the customer a payable link."*

**Email delivery investigation checklist**:
1. Confirm Vercel production env has `RESEND_API_KEY` and `EMAIL_FROM` set (non-empty). `.env.prod` has them locally; verify the dashboard values match.
2. Confirm `NEXT_PUBLIC_APP_URL` in Vercel is the real production domain, not `localhost`.
3. In the Resend dashboard, verify the `EMAIL_FROM` domain is verified and the workspace is out of any sandbox/restricted-sending mode.
4. Check Vercel runtime logs for `[email] send failed:` or `[event-bus] handler failed:` after pressing **Send**.
5. Ensure the invoice customer has a non-empty email; if it says "Walk-in customer", no email will be sent by design.
6. Verify `src/instrumentation.ts` is running in production (Next.js 16 stable instrumentation). If the function is not executing, `registerNotifications()` never attaches handlers and no email is sent despite the action succeeding.

**Recommended next phase**: `/epcc-plan fix-invoice-send-modal-and-email-feedback` (UI fix + optional delivery-status plumbing), followed by `/epcc-code`.
