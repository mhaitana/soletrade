import "server-only";
import { getDataClient } from "@/server/db/client";
import {
  parsePgTimestamp,
  pgQuote,
  rpc,
  unwrap,
  unwrapCount,
  unwrapMaybe,
} from "@/server/db/helpers";
import { branded } from "@/shared/types/ids";
import { getCustomer } from "@/platform/customers";
import { getWorkspace } from "@/platform/workspaces";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { computeLineItemTotals, lineItemAmountCents } from "@/shared/utils/totals";
import type { QuoteStatus } from "@/server/db/enums";
import type {
  CustomerId,
  InvoiceId,
  QuoteAcceptanceId,
  QuoteId,
  QuoteLineItemId,
  QuoteSectionId,
  UserId,
  WorkspaceId,
} from "@/shared/types/ids";
// Type-only: the contract the notifications platform expects on QuoteSent/Accepted/Declined
// metadata. Erased at runtime, so this is not a runtime cross-module import (modules may import
// platform types; the boundary rule forbids platform importing modules, not the reverse).
import type { QuoteEmailMeta, QuoteMerchantMeta } from "@/platform/notifications/templates";

/**
 * Quotes module service (Phase 8) — the fourth and final launch module. A quote is a
 * proposal sent to a customer: the merchant drafts it, sends a shareable public link,
 * the customer accepts or declines, and on acceptance the merchant converts it to a
 * draft invoice (orchestrated in the action layer — this service never imports
 * `@/modules/invoices`). Mirrors `@/modules/invoices/index.ts` (line items, totals,
 * customer link, public token, numbering) but has **no Stripe payment** (quotes aren't
 * paid; they're accepted then converted).
 *
 * Status flow: `draft → sent → viewed → (accepted | declined | expired)`; `accepted →
 * converted` (terminal). All queries filter `.eq("workspace_id", workspaceId)` — never
 * trust a client workspace id; the caller resolves it from the session
 * (`requireWorkspaceContext`). Money is integer cents; totals are denormalized onto the
 * quote row via the pure `computeLineItemTotals` so a sent quote's history is preserved.
 * Quote numbers (`QUO-YYYY-NNNN`) are workspace-unique per calendar year.
 *
 * The two atomic create/update sites run through PL/pgSQL RPCs (`create_quote_with_lines`
 * / `update_quote_with_lines`) — PostgREST has no multi-statement transaction, so the
 * insert-quote + insert-lines + insert-sections + unique-number guard + draft-status
 * re-validation live in one `SECURITY DEFINER` function. Everything else is direct
 * PostgREST reads/writes.
 */

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

/** A free-form content section on a quote (Wave 2). */
export interface SectionInput {
  title: string;
  body: string;
  /** True = the customer can opt into this section at accept time. */
  optional?: boolean;
}

export interface QuoteInput {
  customerId?: CustomerId | null;
  issueDate: Date;
  validUntil?: Date | null;
  currency?: string;
  /** Integer percent (10 = 10% GST). */
  taxRate: number;
  /** When true, line-item unit prices are tax-inclusive (gross); tax is back-calculated. */
  pricesIncludeTax?: boolean;
  notes?: string | null;
  /** Terms & Conditions shown on the public page above the accept button (Wave 2). */
  termsConditions?: string | null;
  lineItems: LineItemInput[];
  /** Optional content sections, rendered in `position` order (Wave 2). */
  sections?: SectionInput[];
}

export type QuotePatch = Partial<QuoteInput>;

export interface QuoteRow {
  id: QuoteId;
  workspaceId: WorkspaceId;
  customerId: CustomerId | null;
  customerName: string | null;
  number: string;
  status: QuoteStatus;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  taxRate: number;
  /** True when unit prices are tax-inclusive (gross); see `QuoteInput.pricesIncludeTax`. */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  /** Terms & Conditions (Wave 2). Null = no T&Cs. */
  termsConditions: string | null;
  publicToken: string | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  convertedAt: Date | null;
  convertedInvoiceId: InvoiceId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuoteLineItemRow {
  id: QuoteLineItemId;
  quoteId: QuoteId;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  position: number;
}

/** A content section row (Wave 2). */
export interface QuoteSectionRow {
  id: QuoteSectionId;
  quoteId: QuoteId;
  title: string;
  body: string;
  position: number;
  optional: boolean;
}

export interface QuoteWithItems extends QuoteRow {
  lineItems: QuoteLineItemRow[];
  /** Sections ordered by `position` (Wave 2). Empty when the quote has none. */
  sections: QuoteSectionRow[];
}

const QUOTE_COLUMNS =
  "id, workspace_id, customer_id, number, status, issue_date, valid_until, currency, tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, terms_conditions, public_token, sent_at, accepted_at, declined_at, converted_at, converted_invoice_id, created_at, updated_at, customers!left ( name )";

const LINE_ITEM_COLUMNS =
  "id, quote_id, description, quantity, unit_price_cents, amount_cents, position";

const SECTION_COLUMNS = "id, quote_id, title, body, position, optional";

const ACCEPTANCE_COLUMNS =
  "id, quote_id, accepter_name, accepter_email, ip_address, user_agent, signature, accepted_at";

/** Raw snake_case shape PostgREST returns for a `quotes` row (+ embedded customer name). */
interface QuoteRaw {
  id: string;
  workspace_id: string;
  customer_id: string | null;
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
  public_token: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  converted_at: string | null;
  converted_invoice_id: string | null;
  created_at: string;
  updated_at: string;
  customers: { name: string } | null;
}

interface QuoteLineItemRaw {
  id: string;
  quote_id: string;
  description: string;
  /** numeric(12,2) — generated type says `number`, runtime returns a STRING; `Number()` coerces both. */
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  position: number;
}

interface QuoteSectionRaw {
  id: string;
  quote_id: string;
  title: string;
  body: string;
  position: number;
  optional: boolean;
}

interface QuoteAcceptanceRaw {
  id: string;
  quote_id: string;
  accepter_name: string;
  accepter_email: string | null;
  ip_address: string;
  user_agent: string;
  signature: string | null;
  accepted_at: string;
}

/** Maps a snake_case PostgREST quotes row to the camelCase `QuoteRow`. */
function toQuoteRow(r: QuoteRaw): QuoteRow {
  return {
    id: branded<"QuoteId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    customerId: r.customer_id ? branded<"CustomerId">(r.customer_id) : null,
    customerName: r.customers?.name ?? null,
    number: r.number,
    status: r.status as QuoteStatus,
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
    publicToken: r.public_token,
    sentAt: r.sent_at ? parsePgTimestamp(r.sent_at) : null,
    acceptedAt: r.accepted_at ? parsePgTimestamp(r.accepted_at) : null,
    declinedAt: r.declined_at ? parsePgTimestamp(r.declined_at) : null,
    convertedAt: r.converted_at ? parsePgTimestamp(r.converted_at) : null,
    convertedInvoiceId: r.converted_invoice_id
      ? branded<"InvoiceId">(r.converted_invoice_id)
      : null,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/** Maps a snake_case line-item row, coercing the `numeric` quantity string → number. */
function toLineItemRow(r: QuoteLineItemRaw): QuoteLineItemRow {
  return {
    id: branded<"QuoteLineItemId">(r.id),
    quoteId: branded<"QuoteId">(r.quote_id),
    description: r.description,
    quantity: Number(r.quantity),
    unitPriceCents: r.unit_price_cents,
    amountCents: r.amount_cents,
    position: r.position,
  };
}

function toSectionRow(r: QuoteSectionRaw): QuoteSectionRow {
  return {
    id: branded<"QuoteSectionId">(r.id),
    quoteId: branded<"QuoteId">(r.quote_id),
    title: r.title,
    body: r.body,
    position: r.position,
    optional: r.optional,
  };
}

function toAcceptanceRow(r: QuoteAcceptanceRaw): QuoteAcceptanceRow {
  return {
    id: branded<"QuoteAcceptanceId">(r.id),
    quoteId: branded<"QuoteId">(r.quote_id),
    accepterName: r.accepter_name,
    accepterEmail: r.accepter_email,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    signature: r.signature,
    acceptedAt: parsePgTimestamp(r.accepted_at),
  };
}

/** Format `{prefix}YYYY-NNNN` from a 1-based sequence. The prefix comes from the workspace row. */
function formatQuoteNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}${year}-${String(seq).padStart(4, "0")}`;
}

/** Next workspace-unique quote number for the given year (count existing + 1). Uses the
 *  workspace's configured `quotePrefix` (default "QUO-"). Changing the prefix resets the yearly
 *  sequence (the count is scoped to `${prefix}${year}-`). */
async function nextQuoteNumber(
  workspaceId: WorkspaceId,
  year: number,
  prefix: string,
): Promise<string> {
  const supabase = getDataClient();
  const yearPrefix = `${prefix}${year}-`;
  const n = await unwrapCount(
    supabase
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .like("number", `${yearPrefix}%`),
  );
  return formatQuoteNumber(prefix, year, n + 1);
}

/** Verify a customer belongs to the workspace (IDOR guard). Throws if customerId is set but not found. */
async function assertCustomerInWorkspace(
  workspaceId: WorkspaceId,
  customerId: CustomerId | null | undefined,
): Promise<void> {
  if (!customerId) return;
  const c = await getCustomer(workspaceId, customerId);
  if (!c) throw new Error("Customer not found in this workspace.");
}

/**
 * Create a draft quote. The number is generated per workspace+year; on a rare unique race
 * (two concurrent creates pick the same seq), the insert throws and we retry up to 3×.
 * Draft creation is **audit-only** (no `QuoteCreated` event) — the activity feed shows the
 * lifecycle milestones (sent/accepted/declined/converted/expired), not draft creation,
 * mirroring how invoice draft edits are audit-only.
 */
export async function createQuote(
  workspaceId: WorkspaceId,
  input: QuoteInput,
  actorId: UserId,
): Promise<QuoteId> {
  if (input.lineItems.length === 0) throw new Error("A quote needs at least one line item.");
  await assertCustomerInWorkspace(workspaceId, input.customerId ?? null);

  const pricesIncludeTax = input.pricesIncludeTax ?? false;
  const totals = computeLineItemTotals(input.lineItems, input.taxRate, { pricesIncludeTax });
  const year = new Date().getFullYear();
  const supabase = getDataClient();
  // The workspace row carries the configured quote prefix + default currency (migration 0018).
  const workspace = await getWorkspace(workspaceId);
  const quotePrefix = workspace?.quotePrefix ?? "QUO-";
  const defaultCurrency = workspace?.defaultCurrency ?? "AUD";

  // The number is generated per workspace+year; on a rare unique race the
  // `create_quote_with_lines` RPC's insert hits the unique index → `error.code === '23505'`
  // and we retry. The 3× retry stays in JS; the RPC is the atomic insert (quote + line
  // items + sections) + the unique-index guard. Draft creation is audit-only (no
  // `QuoteCreated` event), mirroring invoice draft creation.
  let attempts = 0;
  let lastErr: unknown;
  let quoteId: string | null = null;
  let number = "";
  while (attempts < 3) {
    attempts += 1;
    number = await nextQuoteNumber(workspaceId, year, quotePrefix);
    const { data, error } = await rpc(supabase, "create_quote_with_lines", {
      p_workspace_id: workspaceId,
      p_customer_id: input.customerId ?? null,
      p_number: number,
      p_issue_date: input.issueDate.toISOString(),
      p_valid_until: input.validUntil ? input.validUntil.toISOString() : null,
      p_currency: input.currency ?? defaultCurrency,
      p_tax_rate: input.taxRate,
      p_prices_include_tax: pricesIncludeTax,
      p_subtotal_cents: totals.subtotalCents,
      p_tax_cents: totals.taxCents,
      p_total_cents: totals.totalCents,
      p_notes: input.notes ?? null,
      p_terms_conditions: input.termsConditions ?? null,
      p_line_items: input.lineItems.map((it, i) => ({
        description: it.description,
        quantity: String(it.quantity),
        unit_price_cents: it.unitPriceCents,
        amount_cents: lineItemAmountCents(it.quantity, it.unitPriceCents),
        position: i,
      })),
      p_sections: input.sections
        ? input.sections.map((s, i) => ({
            title: s.title,
            body: s.body,
            position: i,
            optional: s.optional ?? false,
          }))
        : null,
    });
    if (error) {
      if (error.code === "23505") {
        lastErr = new Error(`PostgREST error [${error.code}]: ${error.message}`);
        continue;
      }
      throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
    }
    quoteId = data;
    break;
  }
  if (!quoteId) throw lastErr ?? new Error("Failed to generate a unique quote number.");
  const id = branded<"QuoteId">(quoteId);

  // writeAudit runs AFTER the rpc returns (was inside the Drizzle transaction). Draft
  // creation is audit-only — no activity event.
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "quote.create",
    targetType: "quote",
    targetId: id,
    metadata: {
      number,
      totalCents: totals.totalCents,
      lineItemCount: input.lineItems.length,
      sectionCount: input.sections?.length ?? 0,
    },
  });
  return id;
}

/**
 * Update a draft quote (line items + sections are replaced; totals recomputed). Throws if the
 * quote is not a draft or doesn't belong to the workspace. Sections are replaced-on-update
 * (mirrors line items); pass `sections: []` to clear them, omit to leave them untouched.
 */
export async function updateQuote(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
  patch: QuotePatch,
  actorId: UserId,
): Promise<void> {
  if (patch.lineItems !== undefined && patch.lineItems.length === 0) {
    throw new Error("A quote needs at least one line item.");
  }
  await assertCustomerInWorkspace(workspaceId, patch.customerId ?? null);

  const supabase = getDataClient();
  // Read the current row OUTSIDE the rpc for the totals recompute. The
  // `update_quote_with_lines` RPC re-validates draft status under a row lock as the race
  // guard (raises "Only draft quotes can be edited." if a concurrent send slipped in).
  const current = await unwrapMaybe(
    supabase
      .from("quotes")
      .select("id, status, tax_rate, prices_include_tax")
      .eq("id", quoteId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!current) throw new Error("Quote not found.");
  if (current.status !== "draft") throw new Error("Only draft quotes can be edited.");

  const newLineItems = patch.lineItems;
  const newTaxRate = patch.taxRate;
  // The inclusive flag can be patched; otherwise carry the existing row's value so a
  // line-item/tax-rate edit on an inclusive quote keeps treating prices as gross.
  const pricesIncludeTax = patch.pricesIncludeTax ?? current.prices_include_tax;
  let totals: { subtotalCents: number; taxCents: number; totalCents: number } | null = null;
  if (newLineItems !== undefined) {
    totals = computeLineItemTotals(newLineItems, newTaxRate ?? current.tax_rate, {
      pricesIncludeTax,
    });
  } else if (newTaxRate !== undefined || patch.pricesIncludeTax !== undefined) {
    const existing = await unwrap(
      supabase
        .from("quote_line_items")
        .select("quantity, unit_price_cents")
        .eq("quote_id", quoteId),
    );
    totals = computeLineItemTotals(
      existing.map((e) => ({ quantity: Number(e.quantity), unitPriceCents: e.unit_price_cents })),
      newTaxRate ?? current.tax_rate,
      { pricesIncludeTax },
    );
  }

  // Build the patch as a snake_case jsonb object — only keys present change; a null value
  // sets the column to null. The RPC overlays this onto the locked row with
  // jsonb_populate_record, then optionally replaces line items + sections. Pass `[]` to
  // clear sections; omit (null) to keep them. updated_at is set by the RPC, so omitted.
  const set: Record<string, unknown> = {};
  if (patch.customerId !== undefined) set.customer_id = patch.customerId ?? null;
  if (patch.issueDate !== undefined) set.issue_date = patch.issueDate.toISOString();
  if (patch.validUntil !== undefined)
    set.valid_until = patch.validUntil ? patch.validUntil.toISOString() : null;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (newTaxRate !== undefined) set.tax_rate = newTaxRate;
  if (patch.pricesIncludeTax !== undefined) set.prices_include_tax = patch.pricesIncludeTax;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.termsConditions !== undefined) set.terms_conditions = patch.termsConditions ?? null;
  if (totals) {
    set.subtotal_cents = totals.subtotalCents;
    set.tax_cents = totals.taxCents;
    set.total_cents = totals.totalCents;
  }

  const lineItemsJson =
    newLineItems !== undefined
      ? newLineItems.map((it, i) => ({
          description: it.description,
          quantity: String(it.quantity),
          unit_price_cents: it.unitPriceCents,
          amount_cents: lineItemAmountCents(it.quantity, it.unitPriceCents),
          position: i,
        }))
      : null;
  const sectionsJson =
    patch.sections !== undefined
      ? patch.sections.map((s, i) => ({
          title: s.title,
          body: s.body,
          position: i,
          optional: s.optional ?? false,
        }))
      : null;

  const { error } = await rpc(supabase, "update_quote_with_lines", {
    p_workspace_id: workspaceId,
    p_quote_id: quoteId,
    p_set: set,
    p_line_items: lineItemsJson,
    p_sections: sectionsJson,
  });
  if (error) {
    throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  }

  // Draft edits are audit-only — not surfaced to the activity feed (too noisy).
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "quote.update",
    targetType: "quote",
    targetId: quoteId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** List quotes for a workspace, optionally filtered by status/search/customer. */
export async function listQuotes(
  workspaceId: WorkspaceId,
  opts?: { status?: QuoteStatus; search?: string; customerId?: CustomerId; limit?: number },
): Promise<QuoteRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 200);
  let query = supabase.from("quotes").select(QUOTE_COLUMNS).eq("workspace_id", workspaceId);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.customerId) query = query.eq("customer_id", opts.customerId);
  const search = opts?.search?.trim();
  if (search) {
    // PostgREST `or` can't reference embedded/foreign columns (PGRST100), so replicate the
    // Drizzle leftJoin + `or(ilike number, ilike customers.name, ilike customers.company)` in
    // two local-only steps: (1) find customer ids matching the name/company ILIKE (no
    // deleted_at filter — the original leftJoin didn't exclude soft-deleted customers);
    // (2) `or(number.ilike.X, customer_id.in.(ids))` on quotes.
    const term = pgQuote(`%${search}%`);
    const matching = await unwrap(
      supabase
        .from("customers")
        .select("id")
        .eq("workspace_id", workspaceId)
        .or(`name.ilike.${term},company.ilike.${term}`),
    );
    const customerIds = matching.map((m) => m.id);
    if (customerIds.length > 0) {
      query = query.or(`number.ilike.${term},customer_id.in.(${customerIds.join(",")})`);
    } else {
      query = query.or(`number.ilike.${term}`);
    }
  }

  const rows = await unwrap(
    query
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return rows.map((r) => toQuoteRow(r as QuoteRaw));
}

/**
 * Fetch a single quote with its line items + sections, scoped to the workspace. IDOR-safe —
 * returns null when the quote belongs to another workspace.
 */
export async function getQuote(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
): Promise<QuoteWithItems | null> {
  const supabase = getDataClient();
  const q = await unwrapMaybe(
    supabase
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("id", quoteId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!q) return null;
  const quote = toQuoteRow(q as QuoteRaw);

  const [itemRows, sectionRows] = await Promise.all([
    unwrap(
      supabase
        .from("quote_line_items")
        .select(LINE_ITEM_COLUMNS)
        .eq("quote_id", quoteId)
        .order("position", { ascending: true }),
    ),
    unwrap(
      supabase
        .from("quote_sections")
        .select(SECTION_COLUMNS)
        .eq("quote_id", quoteId)
        .order("position", { ascending: true }),
    ),
  ]);
  return {
    ...quote,
    lineItems: itemRows.map((r) => toLineItemRow(r as QuoteLineItemRaw)),
    sections: sectionRows.map((r) => toSectionRow(r as QuoteSectionRaw)),
  };
}

/**
 * Transition a quote to a new status, guarded by `allowedFrom` states. The
 * `.in("status", allowedFrom)` clause makes it atomic + idempotent: a concurrent
 * transition that already moved the quote out of an allowed state makes this update
 * match zero rows (returns null → caller treats as no-op). Returns the quote number for
 * audit/event, or null if nothing was transitioned.
 */
async function transition(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
  to: QuoteStatus,
  allowedFrom: QuoteStatus[],
  set: Partial<{
    sentAt: Date;
    acceptedAt: Date;
    declinedAt: Date;
    convertedAt: Date;
    convertedInvoiceId: InvoiceId;
    publicToken: string;
  }>,
): Promise<{ number: string } | null> {
  const supabase = getDataClient();
  // Explicit column-keyed shape (not a loose Record<string, unknown>) — the generated
  // `.update()` type rejects an `unknown` index signature.
  const update: {
    status: QuoteStatus;
    updated_at: string;
    sent_at?: string;
    accepted_at?: string;
    declined_at?: string;
    converted_at?: string;
    converted_invoice_id?: InvoiceId;
    public_token?: string;
  } = { status: to, updated_at: new Date().toISOString() };
  if (set.sentAt) update.sent_at = set.sentAt.toISOString();
  if (set.acceptedAt) update.accepted_at = set.acceptedAt.toISOString();
  if (set.declinedAt) update.declined_at = set.declinedAt.toISOString();
  if (set.convertedAt) update.converted_at = set.convertedAt.toISOString();
  if (set.convertedInvoiceId !== undefined) update.converted_invoice_id = set.convertedInvoiceId;
  if (set.publicToken !== undefined) update.public_token = set.publicToken;

  const rows = await unwrap(
    supabase
      .from("quotes")
      .update(update)
      .eq("id", quoteId)
      .eq("workspace_id", workspaceId)
      .in("status", allowedFrom)
      .select("id, number"),
  );
  const row = rows[0];
  return row ? { number: row.number } : null;
}

/**
 * Fetch the email-render context for one quote (join customers for the email + name). Used to
 * enrich `QuoteSent` event metadata so the notifications platform can render an email without
 * importing the quotes module (cross-module side effects go via the bus). Returns null if the
 * quote isn't found or has no `publicToken` (a draft has none → no email). `customerEmail` /
 * `customerName` are null for walk-in customers (no customer row).
 */
async function fetchQuoteEmailContext(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
): Promise<QuoteEmailMeta | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("quotes")
      .select(
        "number, total_cents, currency, public_token, valid_until, customer_id, customers!left ( email, name )",
      )
      .eq("id", quoteId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!row || !row.public_token) return null;
  return {
    number: row.number,
    totalCents: row.total_cents,
    currency: row.currency,
    publicToken: row.public_token,
    validUntil: row.valid_until ? parsePgTimestamp(row.valid_until) : null,
    customerId: row.customer_id ? branded<"CustomerId">(row.customer_id) : null,
    customerEmail: row.customers?.email ?? null,
    customerName: row.customers?.name ?? null,
  };
}

/**
 * Fetch the merchant-notification metadata (number + customer) for `QuoteAccepted` /
 * `QuoteDeclined`. Returns null if the quote isn't found.
 */
async function fetchQuoteMerchantMeta(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
): Promise<QuoteMerchantMeta | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("quotes")
      .select("number, total_cents, currency, customers!left ( email, name )")
      .eq("id", quoteId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!row) return null;
  return {
    number: row.number,
    totalCents: row.total_cents,
    currency: row.currency,
    customerEmail: row.customers?.email ?? null,
    customerName: row.customers?.name ?? null,
  };
}

/**
 * Send a draft quote: `draft → sent`, sets `sentAt` + a random `publicToken` (for the
 * public page). Enriches the `QuoteSent` event with the email-render context so the
 * notifications platform can email the customer. Returns false if the quote wasn't a
 * draft (already sent / not found) — idempotent.
 */
export async function sendQuote(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
  actorId: UserId,
): Promise<boolean> {
  const publicToken = crypto.randomUUID();
  const result = await transition(workspaceId, quoteId, "sent", ["draft"], {
    sentAt: new Date(),
    publicToken,
  });
  if (!result) return false;
  const ctx = await fetchQuoteEmailContext(workspaceId, quoteId);
  await publishEvent({
    type: "QuoteSent",
    workspaceId,
    actorUserId: actorId,
    entityType: "quote",
    entityId: quoteId,
    metadata: ctx ?? { number: result.number, publicToken },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "quote.send",
    targetType: "quote",
    targetId: quoteId,
    metadata: { number: result.number },
  });
  return true;
}

/**
 * Hard-delete a draft quote (cascades line items). Only drafts — a sent/accepted/declined/
 * expired/converted quote is never deleted (the audit trail + history are preserved).
 * Returns false if not a draft or not found.
 */
export async function deleteQuote(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
  actorId: UserId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("quotes")
      .delete()
      .eq("id", quoteId)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .select("id, number"),
  );
  const row = rows[0];
  if (!row) return false;
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "quote.delete",
    targetType: "quote",
    targetId: quoteId,
    metadata: { number: row.number },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Phase 8 — public page + accept/decline + convert + expire job
// ---------------------------------------------------------------------------

/**
 * Sanitized quote shape for the **public** `/q/[token]` page. Deliberately omits all
 * workspace-internal ids (`workspaceId`, internal `customerId`, internal quote/line-item
 * ids) and the private `notes` per the design-system security spec — the public HTML must
 * only expose what the customer needs to accept/decline. `convertedInvoiceId` is exposed
 * so the public page can show "converted to an invoice" without leaking the invoice URL
 * (the merchant shares the invoice separately).
 */
export interface PublicQuoteView {
  number: string;
  status: QuoteStatus;
  customerName: string | null;
  issueDate: Date;
  validUntil: Date | null;
  currency: string;
  taxRate: number;
  /** True when unit prices are tax-inclusive (shown as "(includes $X tax)"). */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lineItems: {
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }[];
  /** Optional content sections (Wave 2), ordered by position. Customer-visible. */
  sections: {
    title: string;
    body: string;
    optional: boolean;
  }[];
  /** Terms & Conditions (Wave 2). Null = no T&Cs to show. */
  termsConditions: string | null;
  sentAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  convertedInvoiceId: InvoiceId | null;
}

/**
 * Look up a quote by its public token for the `/q/[token]` page. Returns null if the
 * token doesn't match OR the quote is a draft (never sent) / expired / converted /
 * declined — only `sent` / `viewed` / `accepted` quotes are publicly viewable (once
 * accepted the customer can still see it to confirm). The partial unique index on
 * `publicToken` makes this lookup indexed. No `workspaceId` param — the token IS the
 * credential (unguessable 122-bit random).
 */
export async function getQuoteByPublicToken(token: string): Promise<PublicQuoteView | null> {
  const supabase = getDataClient();
  const q = await unwrapMaybe(
    supabase.from("quotes").select(QUOTE_COLUMNS).eq("public_token", token).limit(1).maybeSingle(),
  );
  if (!q) return null;
  const r = q as QuoteRaw;
  if (
    r.status === "draft" ||
    r.status === "expired" ||
    r.status === "converted" ||
    r.status === "declined"
  ) {
    return null;
  }

  const [itemRows, sectionRows] = await Promise.all([
    unwrap(
      supabase
        .from("quote_line_items")
        .select(LINE_ITEM_COLUMNS)
        .eq("quote_id", r.id)
        .order("position", { ascending: true }),
    ),
    unwrap(
      supabase
        .from("quote_sections")
        .select(SECTION_COLUMNS)
        .eq("quote_id", r.id)
        .order("position", { ascending: true }),
    ),
  ]);

  return {
    number: r.number,
    status: r.status as QuoteStatus,
    customerName: r.customers?.name ?? null,
    issueDate: parsePgTimestamp(r.issue_date),
    validUntil: r.valid_until ? parsePgTimestamp(r.valid_until) : null,
    currency: r.currency,
    taxRate: r.tax_rate,
    pricesIncludeTax: r.prices_include_tax,
    subtotalCents: r.subtotal_cents,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    lineItems: itemRows.map((it) => {
      const li = it as QuoteLineItemRaw;
      return {
        description: li.description,
        quantity: Number(li.quantity),
        unitPriceCents: li.unit_price_cents,
        amountCents: li.amount_cents,
      };
    }),
    sections: sectionRows.map((s) => {
      const sec = s as QuoteSectionRaw;
      return { title: sec.title, body: sec.body, optional: sec.optional };
    }),
    termsConditions: r.terms_conditions,
    sentAt: r.sent_at ? parsePgTimestamp(r.sent_at) : null,
    acceptedAt: r.accepted_at ? parsePgTimestamp(r.accepted_at) : null,
    declinedAt: r.declined_at ? parsePgTimestamp(r.declined_at) : null,
    convertedInvoiceId: r.converted_invoice_id
      ? branded<"InvoiceId">(r.converted_invoice_id)
      : null,
  };
}

/**
 * Record a customer view of a sent quote: `sent → viewed`, idempotent. Returns true if the
 * status changed (first view), false if already viewed / not sent (no-op, no duplicate event).
 * The `transition` `.in("status", ["sent"])` clause makes a concurrent double-view
 * race-safe — only one wins. The workspaceId is resolved internally and never returned.
 */
export async function markQuoteViewed(token: string): Promise<boolean> {
  const supabase = getDataClient();
  const found = await unwrapMaybe(
    supabase
      .from("quotes")
      .select("id, workspace_id")
      .eq("public_token", token)
      .limit(1)
      .maybeSingle(),
  );
  if (!found) return false;
  const workspaceId = branded<"WorkspaceId">(found.workspace_id);
  const quoteId = branded<"QuoteId">(found.id);

  const result = await transition(workspaceId, quoteId, "viewed", ["sent"], {});
  if (!result) return false;
  await publishEvent({
    type: "QuoteViewed",
    workspaceId,
    entityType: "quote",
    entityId: quoteId,
    metadata: { number: result.number },
  });
  await writeAudit({
    workspaceId,
    actorUserId: undefined,
    action: "quote.viewed",
    targetType: "quote",
    targetId: quoteId,
    metadata: { number: result.number, source: "public_page" },
  });
  return true;
}

/**
 * Acceptance metadata captured at accept time (Wave 2). `accepterName` is required (the
 * customer types their name); the rest is captured from the request by the public action
 * and threaded in. `signature` is a typed name or a canvas-captured data-URL — acceptance
 * evidence, not a cryptographic signature.
 */
export interface AcceptanceMeta {
  accepterName: string;
  accepterEmail?: string | null;
  signature?: string | null;
  ipAddress: string;
  userAgent: string;
}

/**
 * Customer accepts a quote (public action): `sent|viewed → accepted`, sets `acceptedAt`,
 * and writes a `quote_acceptances` row capturing who accepted + from where (Wave 2 — the
 * legally-meaningful evidence the spec calls for; the prior implementation stored only
 * `acceptedAt`). Publishes `QuoteAccepted` enriched with merchant-notification metadata
 * (including `accepterName` + `ipAddress`) so the notifications platform can email workspace
 * members. Returns false if the quote isn't in an allowed state or not found — idempotent
 * via the atomic `transition` (a duplicate accept writes no second acceptance row because
 * the transition matches zero rows).
 */
export async function acceptQuote(token: string, metaInput: AcceptanceMeta): Promise<boolean> {
  if (!metaInput.accepterName.trim()) throw new Error("Accepter name is required.");
  const supabase = getDataClient();
  const found = await unwrapMaybe(
    supabase
      .from("quotes")
      .select("id, workspace_id")
      .eq("public_token", token)
      .limit(1)
      .maybeSingle(),
  );
  if (!found) return false;
  const workspaceId = branded<"WorkspaceId">(found.workspace_id);
  const quoteId = branded<"QuoteId">(found.id);

  const acceptedAt = new Date();
  const result = await transition(workspaceId, quoteId, "accepted", ["sent", "viewed"], {
    acceptedAt,
  });
  if (!result) return false;

  // Record the acceptance (one row per accept event — full audit trail). Written after the
  // transition succeeds; a duplicate accept can't reach here (transition matched zero rows).
  await unwrap(
    supabase.from("quote_acceptances").insert({
      quote_id: quoteId,
      workspace_id: workspaceId,
      accepter_name: metaInput.accepterName.trim(),
      accepter_email: metaInput.accepterEmail ?? null,
      ip_address: metaInput.ipAddress,
      user_agent: metaInput.userAgent,
      signature: metaInput.signature ?? null,
      accepted_at: acceptedAt.toISOString(),
    }),
  );

  const meta = await fetchQuoteMerchantMeta(workspaceId, quoteId);
  await publishEvent({
    type: "QuoteAccepted",
    workspaceId,
    entityType: "quote",
    entityId: quoteId,
    metadata: {
      ...(meta ?? { number: result.number }),
      accepterName: metaInput.accepterName,
      ipAddress: metaInput.ipAddress,
    },
  });
  await writeAudit({
    workspaceId,
    actorUserId: undefined,
    action: "quote.accept",
    targetType: "quote",
    targetId: quoteId,
    metadata: {
      number: result.number,
      source: "public_page",
      accepterName: metaInput.accepterName,
      ipAddress: metaInput.ipAddress,
    },
  });
  return true;
}

/** Decline metadata captured at decline time (Wave 2). No `decline_declines` table — IP/UA
 *  are stored in the event metadata + audit only (declines are less legally significant). */
export interface DeclineMeta {
  ipAddress: string;
  userAgent: string;
  reason?: string | null;
}

/**
 * Customer declines a quote (public action): `sent|viewed → declined`, sets `declinedAt`.
 * Publishes `QuoteDeclined` enriched with merchant-notification metadata + IP/UA. Returns
 * false if the quote isn't in an allowed state or not found — idempotent.
 */
export async function declineQuote(token: string, metaInput: DeclineMeta): Promise<boolean> {
  const supabase = getDataClient();
  const found = await unwrapMaybe(
    supabase
      .from("quotes")
      .select("id, workspace_id")
      .eq("public_token", token)
      .limit(1)
      .maybeSingle(),
  );
  if (!found) return false;
  const workspaceId = branded<"WorkspaceId">(found.workspace_id);
  const quoteId = branded<"QuoteId">(found.id);

  const result = await transition(workspaceId, quoteId, "declined", ["sent", "viewed"], {
    declinedAt: new Date(),
  });
  if (!result) return false;
  const meta = await fetchQuoteMerchantMeta(workspaceId, quoteId);
  await publishEvent({
    type: "QuoteDeclined",
    workspaceId,
    entityType: "quote",
    entityId: quoteId,
    metadata: { ...(meta ?? { number: result.number }), ipAddress: metaInput.ipAddress },
  });
  await writeAudit({
    workspaceId,
    actorUserId: undefined,
    action: "quote.decline",
    targetType: "quote",
    targetId: quoteId,
    metadata: {
      number: result.number,
      source: "public_page",
      ipAddress: metaInput.ipAddress,
      userAgent: metaInput.userAgent,
      reason: metaInput.reason ?? null,
    },
  });
  return true;
}

/** An acceptance record (Wave 2) — the merchant detail page renders this when `status === accepted`. */
export interface QuoteAcceptanceRow {
  id: QuoteAcceptanceId;
  quoteId: QuoteId;
  accepterName: string;
  accepterEmail: string | null;
  ipAddress: string;
  userAgent: string;
  signature: string | null;
  acceptedAt: Date;
}

/**
 * Fetch the most recent acceptance for a quote (Wave 2 — merchant detail page). Workspace-
 * scoped (IDOR-safe). Returns null if the quote has no acceptance row (not accepted, or
 * accepted before Wave 2). Re-acceptances create a new row each time; this returns the
 * latest by `acceptedAt` so the merchant sees the current acceptance evidence.
 */
export async function getAcceptance(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
): Promise<QuoteAcceptanceRow | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("quote_acceptances")
      .select(ACCEPTANCE_COLUMNS)
      .eq("quote_id", quoteId)
      .eq("workspace_id", workspaceId)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row ? toAcceptanceRow(row as QuoteAcceptanceRaw) : null;
}

/**
 * Mark an accepted quote converted to an invoice: `accepted → converted`, sets
 * `convertedInvoiceId` + `convertedAt`. Called by the convert action **after**
 * `createInvoice` succeeds (the action layer orchestrates quotes→invoices; this service
 * never imports `@/modules/invoices`). Publishes `QuoteConvertedToInvoice` (activity-only —
 * no email; the merchant is the one who clicked convert). Returns false if the quote isn't
 * accepted or not found — idempotent via the atomic `transition`.
 */
export async function markQuoteConverted(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
  invoiceId: InvoiceId,
  invoiceNumber: string,
  actorId: UserId,
): Promise<boolean> {
  const result = await transition(workspaceId, quoteId, "converted", ["accepted"], {
    convertedAt: new Date(),
    convertedInvoiceId: invoiceId,
  });
  if (!result) return false;
  await publishEvent({
    type: "QuoteConvertedToInvoice",
    workspaceId,
    actorUserId: actorId,
    entityType: "quote",
    entityId: quoteId,
    metadata: { quoteNumber: result.number, invoiceId, invoiceNumber },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "quote.convert",
    targetType: "quote",
    targetId: quoteId,
    metadata: { quoteNumber: result.number, invoiceId, invoiceNumber },
  });
  return true;
}

/**
 * Flip all sent/viewed quotes past their `validUntil` to `expired` (Phase 8 cron job).
 * One bulk atomic update guarded by `.in("status", ["sent","viewed"])` +
 * `valid_until < now` + `valid_until is not null`. Accepted quotes don't expire (they're
 * heading to conversion). Publishes `QuoteExpired` per flipped quote + writes audit
 * (activity-feed only — no email, mirrors `InvoiceViewed`). Returns the count flipped.
 * `now` is a param so tests can pass a fixed timestamp.
 */
export async function markExpiredQuotes(now: Date = new Date()): Promise<number> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("quotes")
      .update({ status: "expired", updated_at: now.toISOString() })
      .in("status", ["sent", "viewed"])
      .lt("valid_until", now.toISOString())
      .not("valid_until", "is", null)
      .select("id, workspace_id, number"),
  );

  if (rows.length === 0) return 0;

  for (const row of rows) {
    const workspaceId = branded<"WorkspaceId">(row.workspace_id);
    const quoteId = branded<"QuoteId">(row.id);
    await publishEvent({
      type: "QuoteExpired",
      workspaceId,
      entityType: "quote",
      entityId: quoteId,
      metadata: { number: row.number },
    });
    await writeAudit({
      workspaceId,
      actorUserId: undefined,
      action: "quote.expired",
      targetType: "quote",
      targetId: quoteId,
      metadata: { number: row.number, source: "cron" },
    });
  }
  return rows.length;
}

// Re-export for callers that need the totals math directly (e.g. the create form's
// live preview). Keeps the barrel minimal.
export { computeLineItemTotals, lineItemAmountCents } from "@/shared/utils/totals";

// Re-export the pure dashboard aggregator (Phase 9) so the dashboard loader can call it via
// `@/modules/quotes` without importing `./calc` directly.
export {
  summarizeQuotes,
  type QuoteSummary,
  type QuoteSummaryInput,
  type MonthlyQuotePoint,
} from "./calc";
