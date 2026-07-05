import "server-only";
import { env } from "@/shared/lib/env";
import { onEvent, type BusEvent } from "@/server/events";
import { sendEmail } from "@/server/email";
import {
  coerceInvoiceEmailMeta,
  invoiceOverdueEmail,
  invoicePaidEmail,
  invoiceSentEmail,
} from "./templates";

/**
 * Notifications platform (Phase 5c). Subscribes **cross-module side effects go via the event
 * bus** (brief §9): the invoices module publishes rich `InvoiceSent` / `InvoiceOverdue` /
 * `InvoicePaid` events; these handlers render + send the email. This is the seam members/books
 * will extend later — `registerNotifications()` is called once from `src/instrumentation.ts`.
 *
 * Boundary: this module imports `@/server/*` + `@/shared/*` only. It **never** imports
 * `@/modules/*` — the email-render data arrives entirely via event metadata (the contract in
 * `templates.ts`), so no module→platform coupling is needed.
 *
 * All handlers are best-effort: `sendEmail` never throws (it logs + returns on failure), and the
 * event bus isolates a failing handler from the publisher. A walk-in customer with no email
 * (`customerEmail: null`) produces a no-op — the public link still works if the business shares
 * it manually.
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

/**
 * Subscribe the invoice email handlers. Returns an unsubscribe (for tests); in production this is
 * fire-and-forget — wired once at startup in `src/instrumentation.ts`.
 */
export function registerNotifications(): () => void {
  const u1 = onEvent("InvoiceSent", onInvoiceSent);
  const u2 = onEvent("InvoiceOverdue", onInvoiceOverdue);
  const u3 = onEvent("InvoicePaid", onInvoicePaid);
  return () => {
    u1();
    u2();
    u3();
  };
}
