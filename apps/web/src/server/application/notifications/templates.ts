import type {
  InvoiceEmailMeta,
  RenderedEmail,
  QuoteEmailMeta,
  QuoteMerchantMeta,
  MemberInvitedEmailMeta,
  RefundMeta,
} from "@/lib/domain/notifications/email-types";
export type {
  InvoiceEmailMeta,
  RenderedEmail,
  QuoteEmailMeta,
  QuoteMerchantMeta,
  MemberInvitedEmailMeta,
  RefundMeta,
} from "@/lib/domain/notifications/email-types";
/**
 * Invoice email templates (Phase 5c). Pure functions - no `server-only`, no DB, no I/O - so
 * they're unit-testable in isolation (mirrors `@/modules/invoices/totals` purity). Each takes
 * the `InvoiceEmailMeta` payload the invoices module publishes on the event bus + the public
 * app URL, and returns `{ subject, html, text }`.
 *
 * **Standalone HTML** - not React-rendered - because emails render in a mail client, not the
 * browser. Styles are inlined (many clients strip `<style>` tags). The visual language mirrors
 * the public `/i/[token]` page (product branding, amount hero, emerald-for-paid / red-for-overdue
 * accents) but the template is maintained separately and can drift over time (documented
 * limitation in the Phase 5c notes).
 *
 * The `customerEmail` null case is handled by the **handlers** in `index.ts` (no email → no
 * send); templates always render, so they don't branch on it.
 *
 * `customerId` (Phase 6c) is carried by the metadata but ignored by the email templates - it's
 * there so cross-module subscribers (e.g. the Books `InvoicePaid` income recorder) can link
 * without importing the invoices module. Kept in this type because `InvoiceEmailMeta` is the
 * documented "payload the invoices module publishes on the event bus".
 */

import { branded } from "@/types/ids";
import { brand } from "@/config/brand";
import { formatCents } from "@/lib/domain/billing/pricing";
import { formatDate as formatDisplayDate } from "@/utils/format-date";
import { pwaBrand } from "@/config/pwa";
import { urls } from "@/config/urls";

/**
 * Coerce a raw event-bus metadata record into a typed `InvoiceEmailMeta`, validating the
 * shape defensively (the event bus types metadata as `Record<string, unknown>`). Returns null
 * if the record is missing or has no `publicToken` - the caller treats that as a no-op (no
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

/**
 * Money as the app shows it (symbol and thousands separators) followed by the ISO code. An
 * email is read out of context, possibly in another country, so the code stays explicit:
 * "$12,345.00 AUD" rather than the old "AUD 12345.00".
 */
function money(cents: number, currency: string): string {
  const formatted = formatCents(cents, currency || undefined);
  return currency && !formatted.startsWith(currency) ? `${formatted} ${currency}` : formatted;
}

/** Same fixed display locale as the app, so a date does not depend on the server's locale. */
function formatDate(d: Date | null): string {
  return formatDisplayDate(d);
}

/** Escape text that is placed into email HTML (names can contain `&`, `<` and quotes). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** " from Acme Plumbing" when the business is known, otherwise nothing. */
function fromMerchant(merchantName: string | null | undefined): string {
  const name = merchantName?.trim();
  return name ? ` from ${name}` : "";
}

/** Absolute public link to the invoice's payable page. */
export function invoiceLink(publicToken: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/i/${publicToken}`;
}

/** Shared HTML wrapper - HB product lockup + content card + parent copyright. */
function emailHtml(opts: {
  appUrl: string;
  accent: string; // hex
  heading: string;
  preheading?: string;
  bodyHtml: string;
  buttonHref: string;
  buttonLabel: string;
  showButton: boolean;
}): string {
  const logoUrl = new URL(pwaBrand.icons.standard192, opts.appUrl).href;
  const button = opts.showButton
    ? `<a href="${opts.buttonHref}" style="display:inline-block;background:${opts.accent};color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:8px;font-size:15px;">${opts.buttonLabel}</a>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:${pwaBrand.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${pwaBrand.ink};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${pwaBrand.background};">
    <tr><td align="center" style="padding:24px 12px;">
      <!--[if mso]><table role="presentation" align="center" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:20px 24px;border-bottom:1px solid #e7e5e4;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="40" valign="middle"><img src="${logoUrl}" alt="" width="40" height="40" style="display:block;border:0;outline:none;text-decoration:none;border-radius:8px;"></td>
            <td valign="middle" style="padding-left:12px;font-size:18px;line-height:24px;font-weight:600;letter-spacing:-0.01em;color:${pwaBrand.ink};">${brand.productName}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 24px;">
          ${opts.preheading ? `<p style="margin:0 0 4px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#78716c;">${opts.preheading}</p>` : ""}
          <h1 style="margin:0 0 12px;font-size:22px;font-weight:600;color:${opts.accent};">${opts.heading}</h1>
          ${opts.bodyHtml}
          ${button ? `<div style="margin-top:24px;">${button}</div>` : ""}
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="max-width:480px;margin:16px 0 0;font-size:12px;line-height:18px;color:#78716c;">${brand.productName}. If you did not expect this email, you can ignore it.</p>
      <p style="margin:8px 0 0;font-size:12px;line-height:18px;color:#78716c;">© ${brand.companyName}</p>
    </td></tr>
  </table>
</body></html>`;
}

function emailText(text: string): string {
  return `${text}\n\n${brand.productName}\n© ${brand.companyName}`;
}

/** "You have a new invoice" - sent on `InvoiceSent`. */
export function invoiceSentEmail(m: InvoiceEmailMeta, appUrl: string): RenderedEmail {
  const link = invoiceLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const due = m.dueDate ? ` due ${formatDate(m.dueDate)}` : "";
  const from = fromMerchant(m.merchantName);
  const subject = `Invoice ${m.number}${from}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Amount due${due}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">You have a new invoice (${escapeHtml(m.number)})${escapeHtml(from)}. Click below to view the details and pay securely online.</p>`;
  const html = emailHtml({
    appUrl,
    accent: pwaBrand.ink,
    preheading: escapeHtml(`Invoice ${m.number}${from}`),
    heading: "You have a new invoice",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "View & pay invoice",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `You have a new invoice (${m.number})${from}.`,
    `Amount due${due}: ${money(m.totalCents, m.currency)}`,
    ``,
    `View and pay online:`,
    link,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

/** "Your invoice is overdue" - sent on `InvoiceOverdue`. */
export function invoiceOverdueEmail(m: InvoiceEmailMeta, appUrl: string): RenderedEmail {
  const link = invoiceLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const from = fromMerchant(m.merchantName);
  const subject = `Overdue: Invoice ${m.number}${from}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Overdue amount${m.dueDate ? ` · was due ${formatDate(m.dueDate)}` : ""}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">Invoice ${escapeHtml(m.number)}${escapeHtml(from)} is past its due date. Please pay online to avoid further reminders.</p>`;
  const html = emailHtml({
    appUrl,
    accent: "#DC2626",
    preheading: escapeHtml(`Overdue · Invoice ${m.number}${from}`),
    heading: "Your invoice is overdue",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "Pay invoice now",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `Invoice ${m.number}${from} is past its due date${m.dueDate ? ` (was due ${formatDate(m.dueDate)})` : ""}.`,
    `Amount due: ${money(m.totalCents, m.currency)}`,
    ``,
    `Pay online:`,
    link,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

/** "Payment receipt" - sent on `InvoicePaid` (Stripe or manual source). */
export function invoicePaidEmail(
  m: InvoiceEmailMeta & { source: "stripe" | "manual" },
  appUrl: string,
): RenderedEmail {
  const link = invoiceLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const from = fromMerchant(m.merchantName);
  const subject = `Receipt: Invoice ${m.number}${from}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Payment received</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">Thanks - ${m.merchantName?.trim() ? `${escapeHtml(m.merchantName.trim())} has` : "we've"} received your payment for invoice ${escapeHtml(m.number)}. You can view the receipt online anytime.</p>`;
  const html = emailHtml({
    appUrl,
    accent: "#059669",
    preheading: escapeHtml(`Receipt · Invoice ${m.number}${from}`),
    heading: "Payment received",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "View invoice",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `Payment received for invoice ${m.number}${from}.`,
    `Amount: ${money(m.totalCents, m.currency)}`,
    ``,
    `View online:`,
    link,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quote email templates (Phase 8). Same purity + standalone-HTML contract as the
// invoice templates above. Two meta shapes:
//  - `QuoteEmailMeta` - the customer-facing payload on `QuoteSent` (needs publicToken).
//  - `QuoteMerchantMeta` - the merchant-notification payload on `QuoteAccepted` /
//    `QuoteDeclined` (no publicToken - the merchant clicks through to the app, not the
//    public page; informational, no button).
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce a raw event-bus metadata record into a typed `QuoteEmailMeta`. Returns null if
 *  the record is missing or has no `publicToken` (the caller treats that as a no-op). */
export function coerceQuoteEmailMeta(
  record: Record<string, unknown> | undefined,
): QuoteEmailMeta | null {
  if (!record) return null;
  const publicToken = typeof record.publicToken === "string" ? record.publicToken : null;
  if (!publicToken) return null;
  return {
    number: typeof record.number === "string" ? record.number : "",
    totalCents: typeof record.totalCents === "number" ? record.totalCents : 0,
    currency: typeof record.currency === "string" ? record.currency : "",
    publicToken,
    validUntil: record.validUntil instanceof Date ? record.validUntil : null,
    customerEmail: typeof record.customerEmail === "string" ? record.customerEmail : null,
    customerName: typeof record.customerName === "string" ? record.customerName : null,
    customerId:
      typeof record.customerId === "string" ? branded<"CustomerId">(record.customerId) : null,
  };
}

/** Coerce a raw event-bus metadata record into a typed `QuoteMerchantMeta`. Returns null
 *  if the record is missing or has no `number` (the caller treats that as a no-op). */
export function coerceQuoteMerchantMeta(
  record: Record<string, unknown> | undefined,
): QuoteMerchantMeta | null {
  if (!record) return null;
  const number = typeof record.number === "string" ? record.number : null;
  if (!number) return null;
  return {
    number,
    totalCents: typeof record.totalCents === "number" ? record.totalCents : 0,
    currency: typeof record.currency === "string" ? record.currency : "",
    customerName: typeof record.customerName === "string" ? record.customerName : null,
    customerEmail: typeof record.customerEmail === "string" ? record.customerEmail : null,
    accepterName: typeof record.accepterName === "string" ? record.accepterName : null,
    ipAddress: typeof record.ipAddress === "string" ? record.ipAddress : null,
  };
}

/** Absolute public link to the quote's public page (`/q/[token]`). */
export function quoteLink(publicToken: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/q/${publicToken}`;
}

/** "You have a new quote" - sent to the customer on `QuoteSent`. */
export function quoteSentEmail(m: QuoteEmailMeta, appUrl: string): RenderedEmail {
  const link = quoteLink(m.publicToken, appUrl);
  const greeting = m.customerName ? `Hi ${m.customerName},` : "Hello,";
  const valid = m.validUntil ? ` - valid until ${formatDate(m.validUntil)}` : "";
  const from = fromMerchant(m.merchantName);
  const subject = `Quote ${m.number}${from}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Quote amount${valid}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">You have a new quote (${escapeHtml(m.number)})${escapeHtml(from)}. Review the details and accept or decline it online.</p>`;
  const html = emailHtml({
    appUrl,
    accent: pwaBrand.ink,
    preheading: escapeHtml(`Quote ${m.number}${from}`),
    heading: "You have a new quote",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "View quote",
    showButton: true,
  });
  const text = [
    `${greeting}`,
    ``,
    `You have a new quote (${m.number})${from}.${valid}`,
    `Amount: ${money(m.totalCents, m.currency)}`,
    ``,
    `Review and accept or decline online:`,
    link,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

/** "A quote was accepted" - sent to workspace members on `QuoteAccepted`. Informational, no button. */
export function quoteAcceptedEmail(m: QuoteMerchantMeta, appUrl = urls.app): RenderedEmail {
  const customer = m.customerName ? ` from ${m.customerName}` : "";
  const subject = `Quote ${m.number} accepted`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">A quote you sent has been accepted.</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Accepted quote${customer}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">Quote ${m.number}${customer} was accepted by the customer. Convert it to an invoice in ${brand.productName} when you're ready to bill.</p>`;
  const html = emailHtml({
    appUrl,
    accent: "#059669",
    preheading: `Accepted · Quote ${m.number}`,
    heading: "A quote was accepted",
    bodyHtml,
    buttonHref: "#",
    buttonLabel: "",
    showButton: false,
  });
  const text = [
    `A quote you sent has been accepted.`,
    ``,
    `Quote ${m.number}${customer} - ${money(m.totalCents, m.currency)}`,
    ``,
    `Convert it to an invoice in ${brand.productName} when you're ready to bill.`,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

/** "A quote was declined" - sent to workspace members on `QuoteDeclined`. Informational, no button. */
export function quoteDeclinedEmail(m: QuoteMerchantMeta, appUrl = urls.app): RenderedEmail {
  const customer = m.customerName ? ` from ${m.customerName}` : "";
  const subject = `Quote ${m.number} declined`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">A quote you sent was declined.</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Declined quote${customer}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.totalCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">Quote ${m.number}${customer} was declined by the customer. You may want to follow up or issue a revised quote.</p>`;
  const html = emailHtml({
    appUrl,
    accent: "#DC2626",
    preheading: `Declined · Quote ${m.number}`,
    heading: "A quote was declined",
    bodyHtml,
    buttonHref: "#",
    buttonLabel: "",
    showButton: false,
  });
  const text = [
    `A quote you sent was declined.`,
    ``,
    `Quote ${m.number}${customer} - ${money(m.totalCents, m.currency)}`,
    ``,
    `You may want to follow up or issue a revised quote.`,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Member invitation email (Wave 4). Sent to the invitee on `MemberInvited` (and on
// resend). The token carries the single-use accept link `${appUrl}/invite/{token}`.
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce raw event-bus metadata into `MemberInvitedEmailMeta`. The handler resolves
 *  `workspaceName` + `inviterName` from the DB and merges them in; the bus metadata itself
 *  only carries `{email, role, token}` (the token is the secret). Returns null if the
 *  token or email is missing. */
export function coerceMemberInvitedMeta(
  record: Record<string, unknown> | undefined,
): { email: string; role: string; token: string } | null {
  if (!record) return null;
  const token = typeof record.token === "string" ? record.token : null;
  const email = typeof record.email === "string" ? record.email : null;
  if (!token || !email) return null;
  const role = typeof record.role === "string" ? record.role : "employee";
  return { email, role, token };
}

function roleLabel(role: string): string {
  const r = role.charAt(0).toUpperCase() + role.slice(1);
  return r === "Readonly" ? "Read-only" : r;
}

/**
 * Absolute accept link for a workspace invitation. The accept page is the path-based route
 * `app/invite/[token]`; emails sent before this was corrected used `/invite?token=...`,
 * which `app/invite/page.tsx` still redirects here.
 */
export function inviteLink(token: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
}

/** "You're invited to join {workspace}" - sent to the invitee on `MemberInvited`. */
export function memberInvitedEmail(m: MemberInvitedEmailMeta, appUrl: string): RenderedEmail {
  const link = inviteLink(m.token, appUrl);
  const inviter = m.inviterName
    ? `${m.inviterName} invited you to join`
    : "You've been invited to join";
  const subject = `You've been invited to join ${m.workspaceName}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">Hi,</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">${inviter}</p>
    <p style="margin:0 0 16px;font-size:28px;font-weight:600;">${m.workspaceName}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">You've been invited as <strong>${roleLabel(m.role)}</strong>. Click below to accept and create your account. This link expires in 7 days and can only be used once.</p>`;
  const html = emailHtml({
    appUrl,
    accent: "#059669",
    preheading: `Invitation to join ${m.workspaceName}`,
    heading: "You're invited",
    bodyHtml,
    buttonHref: link,
    buttonLabel: "Accept invitation",
    showButton: true,
  });
  const text = [
    `Hi,`,
    ``,
    `${inviter} ${m.workspaceName}.`,
    `You've been invited as ${roleLabel(m.role)}.`,
    ``,
    `Accept and create your account:`,
    link,
    ``,
    `This link expires in 7 days and can only be used once.`,
  ].join("\n");
  return { subject, html, text: emailText(text) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Refund issued email (Wave 4). Sent to workspace members on `RefundIssued` (money
// movement the merchant should see). The bus metadata is loose - `refundCredit`
// carries `{amountCents, currency?, reason, moduleKey}`, the module-cancel card-refund
// path carries `{method:"card", amountCents, moduleKey, stripeRefundId}`. Coercion
// requires only `amountCents`; everything else is optional.
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce raw event-bus metadata into a `RefundMeta`. Returns null if `amountCents` is missing. */
export function coerceRefundMeta(record: Record<string, unknown> | undefined): RefundMeta | null {
  if (!record) return null;
  const amountCents = typeof record.amountCents === "number" ? record.amountCents : null;
  if (amountCents == null) return null;
  return {
    amountCents,
    currency: typeof record.currency === "string" && record.currency ? record.currency : "AUD",
    reason: typeof record.reason === "string" && record.reason ? record.reason : null,
    moduleKey: typeof record.moduleKey === "string" && record.moduleKey ? record.moduleKey : null,
    method: typeof record.method === "string" && record.method ? record.method : null,
  };
}

/** "A refund was issued" - sent to workspace members on `RefundIssued`. Informational, no button. */
export function refundIssuedEmail(m: RefundMeta, appUrl = urls.app): RenderedEmail {
  const modulePart = m.moduleKey ? ` for ${m.moduleKey}` : "";
  const reason = m.reason ? ` - ${m.reason}` : "";
  const subject = `Refund issued${modulePart}`;
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#44403c;">A refund was issued from your workspace.</p>
    <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Refund${modulePart}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:600;font-variant-numeric:tabular-nums;">${money(m.amountCents, m.currency)}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:#44403c;">${m.method ? `Refunded to ${m.method}.` : "The refund has been processed."}${reason}</p>`;
  const html = emailHtml({
    appUrl,
    accent: "#DC2626",
    preheading: `Refund${modulePart}`,
    heading: "A refund was issued",
    bodyHtml,
    buttonHref: "#",
    buttonLabel: "",
    showButton: false,
  });
  const text = [
    `A refund was issued from your workspace.`,
    ``,
    `Amount: ${money(m.amountCents, m.currency)}${modulePart}`,
    reason ? `Reason: ${m.reason}` : ``,
    m.method ? `Method: ${m.method}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, html, text: emailText(text) };
}
