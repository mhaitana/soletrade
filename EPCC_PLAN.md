# Plan: fix-invoice-send-modal-and-email-feedback

**Created**: 2026-07-20 | **Effort**: ~2h | **Complexity**: Simple

## 1. Objective

**Goal**: Fix the Send-invoice UX so the dialog closes on success, the copy tells the user an email will be sent, and the user gets visible confirmation that the action completed.

**Why**: Right now the dialog stays open after a successful send, the description falsely says "No email is sent", and email failures are completely silent. This caused confusion in production where the user thought nothing happened and no email was sent.

**Success**:
- Pressing **Send** immediately closes the confirmation dialog on success.
- The dialog description accurately says the customer will receive a payable email.
- A toast confirms the invoice was sent.
- Unit/integration tests still pass; no type or lint regressions.

## 2. Approach

**From EPCC_EXPLORE.md**:
- The `InvoiceDetailActions` component controls dialog open state with `pending` (`null` = closed, `Action` = open).
- The success path in `run()` currently only calls `router.refresh()` and never clears `pending`.
- `<Toaster />` is already mounted in `src/app/layout.tsx`, and `sonner` is already used elsewhere in the project.

**Implementation plan**:
1. Update `DIALOG_COPY.send.description` in `src/app/(app)/invoices/invoice-detail-actions.tsx` to describe that an email is sent.
2. In the same file, on a successful `sendInvoiceAction`, set `pending` to `null` before/after `router.refresh()` and show `toast.success("Invoice sent to {customerName}.")` (falling back to "Invoice sent." if no customer name is available locally). Keep the existing inline error rendering for action failures.
3. Add/adjust a test in `src/app/(app)/invoices/invoice-detail-actions.test.tsx` (or create it) that asserts the dialog closes after a mocked successful send and the toast helper is called.

**Trade-offs**:
- **Toast vs. returning email status from the Server Action**: Showing a toast from the client is simpler and doesn't require changing the public Server Action return type or waiting for the Resend API round-trip. The action result is already `{ ok: boolean }`, which is enough to know the invoice transitioned and the `InvoiceSent` event was published. Email delivery status remains best-effort by design.
- **Closing before vs. after `router.refresh()`**: Set `pending` to `null` immediately so the dialog closes without waiting for the revalidation round-trip; `router.refresh()` will update the status badge in the background.

## 3. Tasks

### Phase 1: UI copy and dialog behavior (~1h)
1. **Update send-dialog copy** (0.25h)
   - File: `src/app/(app)/invoices/invoice-detail-actions.tsx`
   - Change `DIALOG_COPY.send.description` to describe public token + email.
   - Deps: None
   - Risk: Low

2. **Close dialog and show toast on success** (0.5h)
   - File: `src/app/(app)/invoices/invoice-detail-actions.tsx`
   - Import `toast` from `sonner`, call `setPending(null)` and `toast.success()` on a successful `sendInvoiceAction`; preserve existing error handling.
   - Deps: Task 1
   - Risk: Low

3. **Add/update component tests** (0.5h)
   - File: `src/app/(app)/invoices/invoice-detail-actions.test.tsx`
   - Test that confirming "Send" closes the dialog and calls `toast.success` when the action resolves `{ ok: true }`.
   - Deps: Task 2
   - Risk: Low

### Phase 2: Verification (~0.5h)
4. **Run quality gates** (0.5h)
   - `pnpm type-check`, `pnpm lint`, `pnpm test:ci`.
   - Deps: Tasks 1-3
   - Risk: Low

**Total**: ~2h

## 4. Quality Strategy

- **Unit test**: Mock `sendInvoiceAction`, `deleteInvoiceAction`, `markInvoicePaidAction`, `voidInvoiceAction`, and `useRouter`/`useTransition`. Render the component, open the send dialog, confirm, assert the success path clears the dialog and toasts.
- **Integration test**: Not needed for this UI-only change; the existing `invoices.integration.test.ts` and `index.test.ts` already cover `sendInvoice` and the notification email pipeline.
- **Acceptance criteria**:
  - Dialog closes on successful send.
  - Toast message appears.
  - Dialog copy no longer says "No email is sent".
  - No type/lint/test failures.

## 5. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing tests rely on the dialog staying open or render timing; a naive close could break them. | Low | Update or add tests as part of the change; run the full test suite before finishing. |
| Adjust-during-render warning when closing dialog inline. | Low | Follow the existing project pattern (`create-promotion-dialog.tsx:81-86`) of clearing state directly during render if needed, or use the transition callback path which is already inside `startTransition`. |
| Toast import or `sonner` version mismatch. | Low | `sonner` is already imported in `src/app/layout.tsx` and used by `create-promotion-dialog.tsx`; use the same import pattern. |

## 6. Assumptions & Out of Scope

**Assumptions**:
- The production email delivery issue is separate from this UI fix. The plan only addresses the modal/copy/feedback; resolving actual Resend delivery requires verifying Vercel env + Resend domain verification (captured in `EPCC_EXPLORE.md` checklist).

**Out of scope**:
- Changing Server Action return types to surface email status.
- Adding a delivery-status page or retry mechanism.
- Investigating Resend domain/queue issues.
