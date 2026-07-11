import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, unwrap, unwrapMaybe } from "@/server/db/helpers";
import type { WorkspaceId } from "@/shared/types/ids";
import { branded } from "@/shared/types/ids";
import { renderPdf } from "./index";
import { InvoiceDocument, type InvoicePdfData } from "./documents/invoice-document";
import { QuoteDocument, type QuotePdfData } from "./documents/quote-document";

/**
 * PDF email attachments (Wave 4 G5). Renders an invoice/quote to a base64 PDF for attachment to
 * the `InvoiceSent` / `QuoteSent` emails. The notifications platform can't import `@/modules/*`, so
 * this helper fetches the document + line items directly from the DB (PostgREST) and maps them to
 * the local `InvoicePdfData` / `QuotePdfData` shapes the document components accept (no module
 * coupling). Best-effort: any error returns `null` and the caller sends the email without an
 * attachment rather than dropping it.
 */

export interface PdfAttachment {
  filename: string;
  /** Base64-encoded PDF bytes (Resend's `attachments[].content` format). */
  content: string;
}

/** Raw snake_case shape PostgREST returns for the invoice columns we read here. */
interface InvoiceRaw {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  tax_rate: number;
  prices_include_tax: boolean;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string | null;
  customers: { name: string } | null;
}

interface InvoiceLineRaw {
  id: string;
  description: string;
  /** numeric(12,2) — generated type `number`, runtime string; `Number()` coerces both. */
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
}

interface QuoteRaw {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  tax_rate: number;
  prices_include_tax: boolean;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string | null;
  terms_conditions: string | null;
  customers: { name: string } | null;
}

interface QuoteLineRaw {
  id: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
}

interface QuoteSectionRaw {
  id: string;
  title: string;
  body: string;
  optional: boolean;
}

/** Render an invoice PDF attachment, or null on any failure (best-effort). */
export async function renderInvoiceAttachment(
  workspaceId: WorkspaceId,
  invoiceId: string,
): Promise<PdfAttachment | null> {
  try {
    const supabase = getDataClient();
    const inv = await unwrapMaybe(
      supabase
        .from("invoices")
        .select(
          "id, number, status, issue_date, due_date, currency, tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, customers!left ( name )",
        )
        .eq("id", branded<"InvoiceId">(invoiceId))
        .eq("workspace_id", workspaceId)
        .limit(1)
        .maybeSingle(),
    );
    if (!inv) return null;
    const r = inv as InvoiceRaw;

    const itemRows = await unwrap(
      supabase
        .from("invoice_line_items")
        .select("id, description, quantity, unit_price_cents, amount_cents")
        .eq("invoice_id", branded<"InvoiceId">(invoiceId))
        .order("position", { ascending: true }),
    );

    const data: InvoicePdfData = {
      number: r.number,
      status: r.status,
      issueDate: parsePgTimestamp(r.issue_date),
      dueDate: r.due_date ? parsePgTimestamp(r.due_date) : null,
      currency: r.currency,
      taxRate: r.tax_rate,
      pricesIncludeTax: r.prices_include_tax,
      subtotalCents: r.subtotal_cents,
      taxCents: r.tax_cents,
      totalCents: r.total_cents,
      notes: r.notes,
      customerName: r.customers?.name ?? null,
      lineItems: itemRows.map((it) => {
        const li = it as InvoiceLineRaw;
        return {
          id: li.id,
          description: li.description,
          quantity: Number(li.quantity),
          unitPriceCents: li.unit_price_cents,
          amountCents: li.amount_cents,
        };
      }),
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
    const supabase = getDataClient();
    const q = await unwrapMaybe(
      supabase
        .from("quotes")
        .select(
          "id, number, status, issue_date, valid_until, currency, tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, terms_conditions, customers!left ( name )",
        )
        .eq("id", branded<"QuoteId">(quoteId))
        .eq("workspace_id", workspaceId)
        .limit(1)
        .maybeSingle(),
    );
    if (!q) return null;
    const r = q as QuoteRaw;

    const [itemRows, sectionRows] = await Promise.all([
      unwrap(
        supabase
          .from("quote_line_items")
          .select("id, description, quantity, unit_price_cents, amount_cents")
          .eq("quote_id", branded<"QuoteId">(quoteId))
          .order("position", { ascending: true }),
      ),
      unwrap(
        supabase
          .from("quote_sections")
          .select("id, title, body, optional")
          .eq("quote_id", branded<"QuoteId">(quoteId))
          .order("position", { ascending: true }),
      ),
    ]);

    const data: QuotePdfData = {
      number: r.number,
      status: r.status,
      issueDate: parsePgTimestamp(r.issue_date),
      validUntil: r.valid_until ? parsePgTimestamp(r.valid_until) : null,
      currency: r.currency,
      taxRate: r.tax_rate,
      pricesIncludeTax: r.prices_include_tax,
      subtotalCents: r.subtotal_cents,
      taxCents: r.tax_cents,
      totalCents: r.total_cents,
      notes: r.notes,
      termsConditions: r.terms_conditions,
      customerName: r.customers?.name ?? null,
      lineItems: itemRows.map((it) => {
        const li = it as QuoteLineRaw;
        return {
          id: li.id,
          description: li.description,
          quantity: Number(li.quantity),
          unitPriceCents: li.unit_price_cents,
          amountCents: li.amount_cents,
        };
      }),
      sections: sectionRows.map((s) => {
        const sec = s as QuoteSectionRaw;
        return { id: sec.id, title: sec.title, body: sec.body, optional: sec.optional };
      }),
    };
    const buffer = await renderPdf(<QuoteDocument quote={data} workspaceName={null} />);
    return { filename: `${data.number}.pdf`, content: buffer.toString("base64") };
  } catch (err) {
    console.warn("[pdf] quote attachment render failed:", err);
    return null;
  }
}
