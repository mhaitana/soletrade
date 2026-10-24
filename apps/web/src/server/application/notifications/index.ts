import "server-only";
import { env } from "@/server/infrastructure/config/env";
import { brand } from "@/config/brand";
import { onEvent, type BusEvent } from "@/server/infrastructure/events";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrap, unwrapMaybe } from "@/server/infrastructure/db/helpers";
import type { WorkspaceId } from "@/types/ids";
import { sendEmail } from "@/server/infrastructure/email";
import {
  coerceInvoiceEmailMeta,
  coerceMemberInvitedMeta,
  coerceQuoteEmailMeta,
  coerceQuoteMerchantMeta,
  coerceRefundMeta,
  invoiceOverdueEmail,
  invoicePaidEmail,
  invoiceSentEmail,
  memberInvitedEmail,
  quoteAcceptedEmail,
  quoteDeclinedEmail,
  quoteSentEmail,
  refundIssuedEmail,
} from "@/server/application/notifications/templates";
import {
  createNotification,
  memberIdsWithPermission,
} from "@/server/foundation/notifications/store";
import {
  renderInvoiceAttachment,
  renderQuoteAttachment,
} from "@/server/application/notifications/attachments";

/**
 * Notifications platform (Phase 5c + Phase 8 quotes). Subscribes **cross-module side
 * effects go via the event bus** (brief §9): the invoices module publishes rich
 * `InvoiceSent` / `InvoiceOverdue` / `InvoicePaid` events and the quotes module
 * publishes `QuoteSent` / `QuoteAccepted` / `QuoteDeclined`; these handlers render +
 * send the email. `registerNotifications()` is called once from
 * `src/instrumentation.ts`.
 *
 * Boundary: this module imports `@/server/*` + `@/shared/*` only. It **never** imports
 * `@/modules/*` - the email-render data arrives entirely via event metadata (the
 * contract in `templates.ts`), so no module→platform coupling is needed. The merchant
 * recipient list for `QuoteAccepted` / `QuoteDeclined` is resolved from
 * `workspaceMembers` joined to `users` (server/db), not from a module.
 *
 * All handlers are best-effort: `sendEmail` never throws (it logs + returns on
 * failure), and the event bus isolates a failing handler from the publisher. A walk-in
 * customer with no email (`customerEmail: null`) produces a no-op - the public link
 * still works if the business shares it manually.
 */

async function onInvoiceSent(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m || !m.customerEmail) return; // no email on file - nothing to send
  const { subject, html, text } = invoiceSentEmail(m, env.NEXT_PUBLIC_APP_URL);
  // Best-effort PDF attachment (Wave 4 G5) - render failure doesn't block the email.
  const attachment =
    event.entityType === "invoice" && event.entityId
      ? await renderInvoiceAttachment(event.workspaceId, event.entityId)
      : null;
  await sendEmail({
    to: m.customerEmail,
    subject,
    html,
    text,
    attachments: attachment ? [attachment] : undefined,
  });
}

async function onInvoiceOverdue(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m || !m.customerEmail) return;
  const { subject, html, text } = invoiceOverdueEmail(m, env.NEXT_PUBLIC_APP_URL);
  await sendEmail({ to: m.customerEmail, subject, html, text });
}

async function onInvoicePaid(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m || !m.customerEmail) return;
  const source =
    event.metadata?.source === "manual" || event.metadata?.source === "stripe"
      ? event.metadata.source
      : "stripe";
  const { subject, html, text } = invoicePaidEmail({ ...m, source }, env.NEXT_PUBLIC_APP_URL);
  await sendEmail({ to: m.customerEmail, subject, html, text });
}

/** "You have a new quote" - sent to the customer on `QuoteSent`. No customer email → no-op. */
async function onQuoteSent(event: BusEvent): Promise<void> {
  const m = coerceQuoteEmailMeta(event.metadata);
  if (!m || !m.customerEmail) return; // no email on file - nothing to send
  const { subject, html, text } = quoteSentEmail(m, env.NEXT_PUBLIC_APP_URL);
  // Best-effort PDF attachment (Wave 4 G5) - render failure doesn't block the email.
  const attachment =
    event.entityType === "quote" && event.entityId
      ? await renderQuoteAttachment(event.workspaceId, event.entityId)
      : null;
  await sendEmail({
    to: m.customerEmail,
    subject,
    html,
    text,
    attachments: attachment ? [attachment] : undefined,
  });
}

/** "You're invited to join {workspace}" - sent to the invitee on `MemberInvited` (Wave 4).
 *  The bus metadata carries `{email, role, token}`; the handler resolves the workspace name +
 *  inviter name from the DB for the email body. Best-effort (never throws). */
async function onMemberInvited(event: BusEvent): Promise<void> {
  const m = coerceMemberInvitedMeta(event.metadata);
  if (!m) return;
  const supabase = getDataClient();
  // Resolve workspace name + inviter full name in one round trip each.
  const wsRow = await unwrapMaybe(
    supabase.from("workspaces").select("name").eq("id", event.workspaceId).maybeSingle(),
  );
  const workspaceName = wsRow?.name ?? brand.productName;
  let inviterName: string | null = null;
  if (event.actorUserId) {
    const uRow = await unwrapMaybe(
      supabase.from("users").select("full_name").eq("id", event.actorUserId).maybeSingle(),
    );
    inviterName = uRow?.full_name ?? null;
  }
  const { subject, html, text } = memberInvitedEmail(
    { email: m.email, role: m.role, token: m.token, workspaceName, inviterName },
    env.NEXT_PUBLIC_APP_URL,
  );
  await sendEmail({ to: m.email, subject, html, text });
}

/** Resolve the email addresses of all members of a workspace (for merchant notifications). */
async function membersEmails(workspaceId: WorkspaceId): Promise<string[]> {
  const supabase = getDataClient();
  // Resource embedding: workspace_members → users (m:1) gives each member's email
  // in one query. Embedding is a left join, so a member whose user row is missing
  // yields `users: null` - filtered out below (equivalent to the original inner join,
  // since every member has a user row by FK).
  const rows = await unwrap(
    supabase.from("workspace_members").select("users ( email )").eq("workspace_id", workspaceId),
  );
  return rows.map((r) => r.users?.email ?? null).filter((email): email is string => email !== null);
}

/** Notify all workspace members a quote was accepted. */
async function onQuoteAccepted(event: BusEvent): Promise<void> {
  const m = coerceQuoteMerchantMeta(event.metadata);
  if (!m) return;
  const recipients = await membersEmails(event.workspaceId);
  if (recipients.length === 0) return;
  const { subject, html, text } = quoteAcceptedEmail(m);
  await Promise.all(recipients.map((to) => sendEmail({ to, subject, html, text })));
}

/** Notify all workspace members a quote was declined. */
async function onQuoteDeclined(event: BusEvent): Promise<void> {
  const m = coerceQuoteMerchantMeta(event.metadata);
  if (!m) return;
  const recipients = await membersEmails(event.workspaceId);
  if (recipients.length === 0) return;
  const { subject, html, text } = quoteDeclinedEmail(m);
  await Promise.all(recipients.map((to) => sendEmail({ to, subject, html, text })));
}

/**
 * Subscribe the invoice + quote email handlers. Returns an unsubscribe (for tests); in
 * production this is fire-and-forget - wired once at startup in `src/instrumentation.ts`.
 */
export function registerNotifications(): () => void {
  const u1 = onEvent("InvoiceSent", onInvoiceSent);
  const u2 = onEvent("InvoiceOverdue", onInvoiceOverdue);
  const u3 = onEvent("InvoicePaid", onInvoicePaid);
  const u4 = onEvent("QuoteSent", onQuoteSent);
  const u5 = onEvent("QuoteAccepted", onQuoteAccepted);
  const u6 = onEvent("QuoteDeclined", onQuoteDeclined);
  const u12 = onEvent("MemberInvited", onMemberInvited);
  // In-app bell notifications (Phase 11c) - merchant-facing events get a row per
  // qualifying member so the bell badge lights up. Best-effort: a DB hiccup is
  // caught + logged so it can't break the event bus or the email side.
  const u7 = onEvent("InvoicePaid", onInvoicePaidInApp);
  const u8 = onEvent("InvoiceOverdue", onInvoiceOverdueInApp);
  const u9 = onEvent("QuoteAccepted", onQuoteAcceptedInApp);
  const u10 = onEvent("QuoteDeclined", onQuoteDeclinedInApp);
  const u11 = onEvent("QuoteExpired", onQuoteExpiredInApp);
  // Wave 4 - coverage gaps: InvoiceVoided / CreditIssued / RefundIssued / InvoiceViewed /
  // QuoteViewed were already published but had no subscriber.
  const u13 = onEvent("InvoiceVoided", onInvoiceVoidedInApp);
  const u14 = onEvent("CreditIssued", onCreditIssuedInApp);
  const u15 = onEvent("RefundIssued", onRefundIssued);
  const u16 = onEvent("InvoiceViewed", onInvoiceViewedInApp);
  const u17 = onEvent("QuoteViewed", onQuoteViewedInApp);
  return () => {
    u1();
    u2();
    u3();
    u4();
    u5();
    u6();
    u7();
    u8();
    u9();
    u10();
    u11();
    u12();
    u13();
    u14();
    u15();
    u16();
    u17();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-app bell notifications (Phase 11c). Customer-facing events stay email-only;
// these merchant-facing events fan out one `notifications` row per active member
// who holds `view:R` for the resource. The bell + `/notifications` page read them.
// All handlers are best-effort: a thrown error is caught so the bus isolates it.
// ─────────────────────────────────────────────────────────────────────────────

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

/** Fan out an in-app notification to every qualifying member. Swallows errors. */
async function fanOutInApp(
  event: BusEvent,
  permission: import("@/lib/domain/permissions").Permission,
  build: () => { type: string; title: string; body?: string } | null,
): Promise<void> {
  try {
    const built = build();
    if (!built) return;
    const recipients = await memberIdsWithPermission(event.workspaceId, permission);
    if (recipients.length === 0) return;
    await Promise.all(
      recipients.map((userId) =>
        createNotification({
          workspaceId: event.workspaceId,
          userId,
          type: built.type,
          title: built.title,
          body: built.body,
          entityType: event.entityType,
          entityId: event.entityId,
        }),
      ),
    );
  } catch (err) {
    console.warn(`In-app notification fan-out failed for ${event.type}:`, err);
  }
}

/** "Invoice paid" - merchant bell row. */
async function onInvoicePaidInApp(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:invoice", () => ({
    type: "invoice.paid",
    title: `Invoice ${m.number} paid`,
    body: `${money(m.totalCents, m.currency)}${m.customerName ? ` from ${m.customerName}` : ""}`,
  }));
}

/** "Invoice overdue" - merchant bell row. */
async function onInvoiceOverdueInApp(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:invoice", () => ({
    type: "invoice.overdue",
    title: `Invoice ${m.number} is overdue`,
    body: `${money(m.totalCents, m.currency)}${m.customerName ? ` from ${m.customerName}` : ""}`,
  }));
}

/** "Quote accepted" - merchant bell row. */
async function onQuoteAcceptedInApp(event: BusEvent): Promise<void> {
  const m = coerceQuoteMerchantMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:quote", () => ({
    type: "quote.accepted",
    title: `Quote ${m.number} accepted`,
    body: `${money(m.totalCents, m.currency)}${m.customerName ? ` from ${m.customerName}` : ""}`,
  }));
}

/** "Quote declined" - merchant bell row. */
async function onQuoteDeclinedInApp(event: BusEvent): Promise<void> {
  const m = coerceQuoteMerchantMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:quote", () => ({
    type: "quote.declined",
    title: `Quote ${m.number} declined`,
    body: m.customerName ? `from ${m.customerName}` : undefined,
  }));
}

/** "Quote expired" - merchant bell row. Metadata carries only `number`. */
async function onQuoteExpiredInApp(event: BusEvent): Promise<void> {
  const number =
    event.metadata && typeof event.metadata.number === "string" ? event.metadata.number : null;
  if (!number) return;
  await fanOutInApp(event, "view:quote", () => ({
    type: "quote.expired",
    title: `Quote ${number} expired`,
    body: "This quote passed its valid-until date without being accepted.",
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4 notification coverage gaps. These events were already published at source
// (invoices/quotes view tracking, billing credit/refund, invoice void) but had no
// subscriber - so the bell never lit up and (for refunds) no email went out. All
// are best-effort; view-tracking events carry only `{ number }` and have no actor.
// ─────────────────────────────────────────────────────────────────────────────

/** Pull a `number` string from event metadata, or null. */
function metadataNumber(event: BusEvent): string | null {
  return event.metadata && typeof event.metadata.number === "string" ? event.metadata.number : null;
}

/** "Invoice voided" - merchant bell row. No email (internal event). */
async function onInvoiceVoidedInApp(event: BusEvent): Promise<void> {
  const number = metadataNumber(event);
  if (!number) return;
  await fanOutInApp(event, "view:invoice", () => ({
    type: "invoice.voided",
    title: `Invoice ${number} voided`,
    body: "The invoice was marked void. No further payment can be collected on it.",
  }));
}

/** "Credit issued" - merchant bell row to billing-aware members. Credits are workspace-scoped
 *  (the ledger is per-workspace), so this fans out to `view:billing` (everyone who can see money). */
async function onCreditIssuedInApp(event: BusEvent): Promise<void> {
  if (!event.metadata) return;
  const amountCents =
    typeof event.metadata.amountCents === "number" ? event.metadata.amountCents : null;
  if (amountCents == null) return;
  const currency =
    typeof event.metadata.currency === "string" && event.metadata.currency
      ? event.metadata.currency
      : "AUD";
  const promotion = Boolean(event.metadata.promotion);
  await fanOutInApp(event, "view:billing", () => ({
    type: "credit.issued",
    title: promotion ? "Promotional credit issued" : "Credit issued",
    body: `${money(amountCents, currency)} added to your platform credit balance`,
  }));
}

/** "Refund issued" - merchant bell row + email. Refunds are user-facing money movement, so
 *  members with `view:billing` get both a bell row and an email. */
async function onRefundIssued(event: BusEvent): Promise<void> {
  const m = coerceRefundMeta(event.metadata);
  if (!m) return;
  // Bell row to billing-aware members.
  await fanOutInApp(event, "view:billing", () => ({
    type: "refund.issued",
    title: "Refund issued",
    body: `${money(m.amountCents, m.currency)}${m.moduleKey ? ` · ${m.moduleKey}` : ""}`,
  }));
  // Email the same cohort (best-effort).
  try {
    const recipients = await membersEmails(event.workspaceId);
    if (recipients.length === 0) return;
    const { subject, html, text } = refundIssuedEmail(m);
    await Promise.all(recipients.map((to) => sendEmail({ to, subject, html, text })));
  } catch (err) {
    console.warn(`Refund email fan-out failed for ${event.type}:`, err);
  }
}

/** "Invoice viewed" - merchant bell row (the customer opened the public invoice page). */
async function onInvoiceViewedInApp(event: BusEvent): Promise<void> {
  const number = metadataNumber(event);
  if (!number) return;
  await fanOutInApp(event, "view:invoice", () => ({
    type: "invoice.viewed",
    title: `Invoice ${number} viewed`,
    body: "Your customer opened the invoice online.",
  }));
}

/** "Quote viewed" - merchant bell row (the customer opened the public quote page). */
async function onQuoteViewedInApp(event: BusEvent): Promise<void> {
  const number = metadataNumber(event);
  if (!number) return;
  await fanOutInApp(event, "view:quote", () => ({
    type: "quote.viewed",
    title: `Quote ${number} viewed`,
    body: "Your customer opened the quote online.",
  }));
}
