import "server-only";
import { eq } from "drizzle-orm";
import { env } from "@/shared/lib/env";
import { onEvent, type BusEvent } from "@/server/events";
import { getDb } from "@/server/db";
import { users, workspaceMembers } from "@/server/db/schema";
import type { WorkspaceId } from "@/shared/types/ids";
import { sendEmail } from "@/server/email";
import {
  coerceInvoiceEmailMeta,
  coerceQuoteEmailMeta,
  coerceQuoteMerchantMeta,
  invoiceOverdueEmail,
  invoicePaidEmail,
  invoiceSentEmail,
  quoteAcceptedEmail,
  quoteDeclinedEmail,
  quoteSentEmail,
} from "./templates";
import { createNotification, memberIdsWithPermission } from "./store";

/**
 * Notifications platform (Phase 5c + Phase 8 quotes). Subscribes **cross-module side
 * effects go via the event bus** (brief §9): the invoices module publishes rich
 * `InvoiceSent` / `InvoiceOverdue` / `InvoicePaid` events and the quotes module
 * publishes `QuoteSent` / `QuoteAccepted` / `QuoteDeclined`; these handlers render +
 * send the email. `registerNotifications()` is called once from
 * `src/instrumentation.ts`.
 *
 * Boundary: this module imports `@/server/*` + `@/shared/*` only. It **never** imports
 * `@/modules/*` — the email-render data arrives entirely via event metadata (the
 * contract in `templates.ts`), so no module→platform coupling is needed. The merchant
 * recipient list for `QuoteAccepted` / `QuoteDeclined` is resolved from
 * `workspaceMembers` joined to `users` (server/db), not from a module.
 *
 * All handlers are best-effort: `sendEmail` never throws (it logs + returns on
 * failure), and the event bus isolates a failing handler from the publisher. A walk-in
 * customer with no email (`customerEmail: null`) produces a no-op — the public link
 * still works if the business shares it manually.
 */

async function onInvoiceSent(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m || !m.customerEmail) return; // no email on file — nothing to send
  const { subject, html, text } = invoiceSentEmail(m, env.NEXT_PUBLIC_APP_URL);
  await sendEmail({ to: m.customerEmail, subject, html, text });
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

/** "You have a new quote" — sent to the customer on `QuoteSent`. No customer email → no-op. */
async function onQuoteSent(event: BusEvent): Promise<void> {
  const m = coerceQuoteEmailMeta(event.metadata);
  if (!m || !m.customerEmail) return; // no email on file — nothing to send
  const { subject, html, text } = quoteSentEmail(m, env.NEXT_PUBLIC_APP_URL);
  await sendEmail({ to: m.customerEmail, subject, html, text });
}

/** Resolve the email addresses of all members of a workspace (for merchant notifications). */
async function membersEmails(workspaceId: WorkspaceId): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return rows.map((r) => r.email);
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
 * production this is fire-and-forget — wired once at startup in `src/instrumentation.ts`.
 */
export function registerNotifications(): () => void {
  const u1 = onEvent("InvoiceSent", onInvoiceSent);
  const u2 = onEvent("InvoiceOverdue", onInvoiceOverdue);
  const u3 = onEvent("InvoicePaid", onInvoicePaid);
  const u4 = onEvent("QuoteSent", onQuoteSent);
  const u5 = onEvent("QuoteAccepted", onQuoteAccepted);
  const u6 = onEvent("QuoteDeclined", onQuoteDeclined);
  // In-app bell notifications (Phase 11c) — merchant-facing events get a row per
  // qualifying member so the bell badge lights up. Best-effort: a DB hiccup is
  // caught + logged so it can't break the event bus or the email side.
  const u7 = onEvent("InvoicePaid", onInvoicePaidInApp);
  const u8 = onEvent("InvoiceOverdue", onInvoiceOverdueInApp);
  const u9 = onEvent("QuoteAccepted", onQuoteAcceptedInApp);
  const u10 = onEvent("QuoteDeclined", onQuoteDeclinedInApp);
  const u11 = onEvent("QuoteExpired", onQuoteExpiredInApp);
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
  permission: import("@/platform/permissions").Permission,
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

/** "Invoice paid" — merchant bell row. */
async function onInvoicePaidInApp(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:invoice", () => ({
    type: "invoice.paid",
    title: `Invoice ${m.number} paid`,
    body: `${money(m.totalCents, m.currency)}${m.customerName ? ` from ${m.customerName}` : ""}`,
  }));
}

/** "Invoice overdue" — merchant bell row. */
async function onInvoiceOverdueInApp(event: BusEvent): Promise<void> {
  const m = coerceInvoiceEmailMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:invoice", () => ({
    type: "invoice.overdue",
    title: `Invoice ${m.number} is overdue`,
    body: `${money(m.totalCents, m.currency)}${m.customerName ? ` from ${m.customerName}` : ""}`,
  }));
}

/** "Quote accepted" — merchant bell row. */
async function onQuoteAcceptedInApp(event: BusEvent): Promise<void> {
  const m = coerceQuoteMerchantMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:quote", () => ({
    type: "quote.accepted",
    title: `Quote ${m.number} accepted`,
    body: `${money(m.totalCents, m.currency)}${m.customerName ? ` from ${m.customerName}` : ""}`,
  }));
}

/** "Quote declined" — merchant bell row. */
async function onQuoteDeclinedInApp(event: BusEvent): Promise<void> {
  const m = coerceQuoteMerchantMeta(event.metadata);
  if (!m) return;
  await fanOutInApp(event, "view:quote", () => ({
    type: "quote.declined",
    title: `Quote ${m.number} declined`,
    body: m.customerName ? `from ${m.customerName}` : undefined,
  }));
}

/** "Quote expired" — merchant bell row. Metadata carries only `number`. */
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
