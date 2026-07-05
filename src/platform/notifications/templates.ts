/**
 * Invoice email templates (Phase 5c). Pure functions — no `server-only`, no DB, no I/O — so
 * they're unit-testable in isolation (mirrors `@/modules/invoices/totals` purity). Each takes
 * the `InvoiceEmailMeta` payload the invoices module publishes on the event bus + the public
 * app URL, and returns `{ subject, html, text }`.
 *
 * **Standalone HTML** — not React-rendered — because emails render in a mail client, not the
 * browser. Styles are inlined (many clients strip `<style>` tags). The visual language mirrors
 * the public `/i/[token]` page (brand wordmark, amount hero, emerald-for-paid / red-for-overdue
 * accents) but the template is maintained separately and can drift over time (documented
 * limitation in the Phase 5c notes).
 *
 * The `customerEmail` null case is handled by the **handlers** in `index.ts` (no email → no
 * send); templates always render, so they don't branch on it.
 *
 * `customerId` (Phase 6c) is carried by the metadata but ignored by the email templates — it's
 * there so cross-module subscribers (e.g. the Books `InvoicePaid` income recorder) can link
 * without importing the invoices module. Kept in this type because `InvoiceEmailMeta` is the
 * documented "payload the invoices module publishes on the event bus".
 */

import { branded, type CustomerId } from "@/shared/types/ids";

export type InvoiceEmailMeta = {
  number: string;
  totalCents: number;
  currency: string;
  customerEmail: string | null;
  customerName: string | null;
  customerId: CustomerId | null;
  publicToken: string;
  dueDate: Date | null;
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Coerce a raw event-bus metadata record into a typed `InvoiceEmailMeta`, validating the
 * shape defensively (the event bus types metadata as `Record<string, unknown>`). Returns null
 * if the record is missing or has no `publicToken` — the caller treats that as a no-op (no
 * email). Used by the notification handlers so they never need an `as` cast on the bus payload.
 */
export function coerceInvoiceEmailMeta(
  record: Record<string, unknown> | undefined,
): InvoiceEmailMeta | null {
  if (!record) return null;
  const publicToken = typeof record.publicToken === "string" ? record.publicToken : null;
  if (!publicToken) return null;
  return {
    number: typeof record.number === "string" ? record.number : "",
    totalCents: typeof record.totalCents === "number" ? record.totalCents : 0,
    currency: typeof record.currency === "string" ? record.currency : "",
    publicToken,
    dueDate: record.dueDate instanceof Date ? record.dueDate : null,
    customerEmail: typeof record.customerEmail === "string" ? record.customerEmail : null,
    customerName: typeof record.customerName === "string" ? record.customerName : null,
    customerId:
      typeof record.customerId === "string" ? branded<"CustomerId">(record.customerId) : null,
  };
}

function money(cents: number, currency: string): string {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Absolute public link to the invoice's payable page. */
export function invoiceLink(publicToken: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/i/${publicToken}`;
}

/** Shared HTML wrapper — brand wordmark + content card + footer. */
function emailHtml(opts: {
  accent: string; // hex
  heading: string;
  preheading?: string;
  bodyHtml: string;
  buttonHref: string;
  buttonLabel: string;
  showButton: boolean;
}): string {
  const button = opts.showButton
    ? `<a href="${opts.buttonHref}" style="display:inline-block;background:${opts.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:8px;font-size:15px;">${opts.buttonLabel}</a>`
    : "";
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
          <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600;letter-spacing:-0.01em;">soletrade labs</span>
        </td></tr>
        <tr><td style="padding:28px 24px;">
          ${opts.preheading ? `<p style="margin:0 0 4px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">${opts.preheading}</p>` : ""}
          <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:${opts.accent};">${opts.heading}</h1>
          ${opts.bodyHtml}
          ${button ? `<div style="margin-top:24px;">${button}</div>` : ""}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">This is a transactional email from soletrade labs. If you did not expect it, you can ignore it.</p>
    </td></tr>
  </table>
</body></html>`;
}

/** "You have a new invoice" — sent on `InvoiceSent`. */
export function invoiceSentEmail(m: InvoiceEmailMeta, appUrl: string): RenderedEmail {
  const link = invoiceLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const due = m.dueDate ? ` due ${formatDate(m.dueDate)}` : "";
  const subject = `Invoice ${m.number} from soletrade labs`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155;">${greeting}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Amount due${due}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#334155;">You have a new invoice (${m.number}). Click below to view the details and pay securely online.</p>`;
  const html = emailHtml({
    accent: "#0f172a",
    preheading: `Invoice ${m.number}`,
    heading: "You have a new invoice",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "View & pay invoice",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `You have a new invoice (${m.number}).`,
    `Amount due${due}: ${money(m.totalCents, m.currency)}`,
    ``,
    `View and pay online:`,
    link,
  ].join("\n");
  return { subject, html, text };
}

/** "Your invoice is overdue" — sent on `InvoiceOverdue`. */
export function invoiceOverdueEmail(m: InvoiceEmailMeta, appUrl: string): RenderedEmail {
  const link = invoiceLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const subject = `Overdue: Invoice ${m.number}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155;">${greeting}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Overdue amount${m.dueDate ? ` · was due ${formatDate(m.dueDate)}` : ""}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#334155;">Invoice ${m.number} is past its due date. Please pay online to avoid further reminders.</p>`;
  const html = emailHtml({
    accent: "#DC2626",
    preheading: `Overdue · Invoice ${m.number}`,
    heading: "Your invoice is overdue",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "Pay invoice now",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `Invoice ${m.number} is past its due date${m.dueDate ? ` (was due ${formatDate(m.dueDate)})` : ""}.`,
    `Amount due: ${money(m.totalCents, m.currency)}`,
    ``,
    `Pay online:`,
    link,
  ].join("\n");
  return { subject, html, text };
}

/** "Payment receipt" — sent on `InvoicePaid` (Stripe or manual source). */
export function invoicePaidEmail(
  m: InvoiceEmailMeta & { source: "stripe" | "manual" },
  appUrl: string,
): RenderedEmail {
  const link = invoiceLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const subject = `Receipt: Invoice ${m.number}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155;">${greeting}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Payment received</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#334155;">Thanks — we've received your payment for invoice ${m.number}. You can view the receipt online anytime.</p>`;
  const html = emailHtml({
    accent: "#059669",
    preheading: `Receipt · Invoice ${m.number}`,
    heading: "Payment received",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "View invoice",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `Payment received for invoice ${m.number}.`,
    `Amount: ${money(m.totalCents, m.currency)}`,
    ``,
    `View online:`,
    link,
  ].join("\n");
  return { subject, html, text };
}
