import "server-only";
import { and, eq, asc } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  customers,
  invoices,
  invoiceLineItems,
  quotes,
  quoteLineItems,
  quoteSections,
} from "@/server/db/schema";
import type { WorkspaceId } from "@/shared/types/ids";
import { branded } from "@/shared/types/ids";
import { renderPdf } from "./index";
import { InvoiceDocument, type InvoicePdfData } from "./documents/invoice-document";
import { QuoteDocument, type QuotePdfData } from "./documents/quote-document";

/**
 * PDF email attachments (Wave 4 G5). Renders an invoice/quote to a base64 PDF for attachment to
 * the `InvoiceSent` / `QuoteSent` emails. The notifications platform can't import `@/modules/*`, so
 * this helper fetches the document + line items directly from the DB schema (`@/server/db`) and
 * maps them to the local `InvoicePdfData` / `QuotePdfData` shapes the document components accept
 * (no module coupling). Best-effort: any error returns `null` and the caller sends the email
 * without an attachment rather than dropping it.
 */

export interface PdfAttachment {
  filename: string;
  /** Base64-encoded PDF bytes (Resend's `attachments[].content` format). */
  content: string;
}

/** Render an invoice PDF attachment, or null on any failure (best-effort). */
export async function renderInvoiceAttachment(
  workspaceId: WorkspaceId,
  invoiceId: string,
): Promise<PdfAttachment | null> {
  try {
    const db = getDb();
    const invRows = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        currency: invoices.currency,
        taxRate: invoices.taxRate,
        pricesIncludeTax: invoices.pricesIncludeTax,
        subtotalCents: invoices.subtotalCents,
        taxCents: invoices.taxCents,
        totalCents: invoices.totalCents,
        notes: invoices.notes,
        customerName: customers.name,
      })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .where(
        and(
          eq(invoices.id, branded<"InvoiceId">(invoiceId)),
          eq(invoices.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    const inv = invRows[0];
    if (!inv) return null;

    const itemRows = await db
      .select({
        id: invoiceLineItems.id,
        description: invoiceLineItems.description,
        quantity: invoiceLineItems.quantity,
        unitPriceCents: invoiceLineItems.unitPriceCents,
        amountCents: invoiceLineItems.amountCents,
      })
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, branded<"InvoiceId">(invoiceId)))
      .orderBy(asc(invoiceLineItems.position));

    const data: InvoicePdfData = {
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      taxRate: inv.taxRate,
      pricesIncludeTax: inv.pricesIncludeTax,
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      notes: inv.notes,
      customerName: inv.customerName ?? null,
      lineItems: itemRows.map((it) => ({
        id: it.id,
        description: it.description,
        quantity: Number(it.quantity),
        unitPriceCents: it.unitPriceCents,
        amountCents: it.amountCents,
      })),
    };
    const buffer = await renderPdf(<InvoiceDocument invoice={data} workspaceName={null} />);
    return { filename: `${data.number}.pdf`, content: buffer.toString("base64") };
  } catch (err) {
    console.warn("[pdf] invoice attachment render failed:", err);
    return null;
  }
}

/** Render a quote PDF attachment, or null on any failure (best-effort). */
export async function renderQuoteAttachment(
  workspaceId: WorkspaceId,
  quoteId: string,
): Promise<PdfAttachment | null> {
  try {
    const db = getDb();
    const qRows = await db
      .select({
        id: quotes.id,
        number: quotes.number,
        status: quotes.status,
        issueDate: quotes.issueDate,
        validUntil: quotes.validUntil,
        currency: quotes.currency,
        taxRate: quotes.taxRate,
        pricesIncludeTax: quotes.pricesIncludeTax,
        subtotalCents: quotes.subtotalCents,
        taxCents: quotes.taxCents,
        totalCents: quotes.totalCents,
        notes: quotes.notes,
        termsConditions: quotes.termsConditions,
        customerName: customers.name,
      })
      .from(quotes)
      .leftJoin(customers, eq(quotes.customerId, customers.id))
      .where(and(eq(quotes.id, branded<"QuoteId">(quoteId)), eq(quotes.workspaceId, workspaceId)))
      .limit(1);
    const q = qRows[0];
    if (!q) return null;

    const [itemRows, sectionRows] = await Promise.all([
      db
        .select({
          id: quoteLineItems.id,
          description: quoteLineItems.description,
          quantity: quoteLineItems.quantity,
          unitPriceCents: quoteLineItems.unitPriceCents,
          amountCents: quoteLineItems.amountCents,
        })
        .from(quoteLineItems)
        .where(eq(quoteLineItems.quoteId, branded<"QuoteId">(quoteId)))
        .orderBy(asc(quoteLineItems.position)),
      db
        .select({
          id: quoteSections.id,
          title: quoteSections.title,
          body: quoteSections.body,
          optional: quoteSections.optional,
        })
        .from(quoteSections)
        .where(eq(quoteSections.quoteId, branded<"QuoteId">(quoteId)))
        .orderBy(asc(quoteSections.position)),
    ]);

    const data: QuotePdfData = {
      number: q.number,
      status: q.status,
      issueDate: q.issueDate,
      validUntil: q.validUntil,
      currency: q.currency,
      taxRate: q.taxRate,
      pricesIncludeTax: q.pricesIncludeTax,
      subtotalCents: q.subtotalCents,
      taxCents: q.taxCents,
      totalCents: q.totalCents,
      notes: q.notes,
      termsConditions: q.termsConditions,
      customerName: q.customerName ?? null,
      lineItems: itemRows.map((it) => ({
        id: it.id,
        description: it.description,
        quantity: Number(it.quantity),
        unitPriceCents: it.unitPriceCents,
        amountCents: it.amountCents,
      })),
      sections: sectionRows.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        optional: s.optional,
      })),
    };
    const buffer = await renderPdf(<QuoteDocument quote={data} workspaceName={null} />);
    return { filename: `${data.number}.pdf`, content: buffer.toString("base64") };
  } catch (err) {
    console.warn("[pdf] quote attachment render failed:", err);
    return null;
  }
}
