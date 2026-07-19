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
import { computeInvoiceTotals, lineItemAmountCents } from "./totals";
import type { InvoiceStatus } from "@/server/db/enums";
import type { Json } from "@/server/db/types";
import type {
  CustomerId,
  InvoiceId,
  InvoiceLineItemId,
  UserId,
  WorkspaceId,
} from "@/shared/types/ids";
import { resolveInvoicePaymentMethods, type PaymentMethods } from "@/shared/types/payment-methods";
// Type-only: the contract the notifications platform expects on InvoiceSent/Overdue/Paid
// metadata. Erased at runtime, so this is not a runtime cross-module import (modules may import
// platform types; the boundary rule forbids platform importing modules, not the reverse).
import type { InvoiceEmailMeta } from "@/platform/notifications/templates";

/**
 * Invoices module service (Phase 5). Workspace-scoped CRUD + status transitions.
 * All queries filter `.eq("workspace_id", workspaceId)` - never trust a client
 * workspace id; the caller resolves it from the session (`requireWorkspaceContext`).
 *
 * Status flow (5a): `draft → sent → paid | void`. `viewed`/`overdue` are unreachable
 * until 5b (public page + reminder job). Money is integer cents; totals are denormalized
 * onto the invoice row via the pure `computeInvoiceTotals` so a sent invoice's history is
 * preserved. Invoice numbers (`INV-YYYY-NNNN`) are workspace-unique per calendar year.
 *
 * The two atomic create/update sites run through PL/pgSQL RPCs (`create_invoice_with_lines`
 * / `update_invoice_with_lines`) - PostgREST has no multi-statement transaction, so the
 * insert-invoice + insert-lines + unique-number guard + draft-status re-validation live in
 * one `SECURITY DEFINER` function. Everything else is direct PostgREST reads/writes.
 */

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface InvoiceInput {
  customerId?: CustomerId | null;
  issueDate: Date;
  dueDate?: Date | null;
  currency?: string;
  /** Integer percent (10 = 10% GST). */
  taxRate: number;
  /** When true, line-item unit prices are tax-inclusive (gross); tax is back-calculated. */
  pricesIncludeTax?: boolean;
  notes?: string | null;
  /** Optional per-invoice payment instructions; overrides workspace default when set. */
  paymentMethods?: PaymentMethods | null;
  lineItems: LineItemInput[];
}

export type InvoicePatch = Partial<InvoiceInput>;

export interface InvoiceRow {
  id: InvoiceId;
  workspaceId: WorkspaceId;
  customerId: CustomerId | null;
  customerName: string | null;
  number: string;
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  taxRate: number;
  /** True when unit prices are tax-inclusive (gross); see `InvoiceInput.pricesIncludeTax`. */
  pricesIncludeTax: boolean;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  /** Per-invoice payment instructions (jsonb array); null when using workspace default. */
  paymentMethods: PaymentMethods | null;
  publicToken: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceLineItemRow {
  id: InvoiceLineItemId;
  invoiceId: InvoiceId;
  description: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  position: number;
}

export interface InvoiceWithItems extends InvoiceRow {
  lineItems: InvoiceLineItemRow[];
}

const INVOICE_COLUMNS =
  "id, workspace_id, customer_id, number, status, issue_date, due_date, currency, tax_rate, prices_include_tax, subtotal_cents, tax_cents, total_cents, notes, payment_methods, public_token, sent_at, paid_at, stripe_payment_intent_id, stripe_charge_id, created_at, updated_at, customers!left ( name ), workspaces!left ( name )";

const LINE_ITEM_COLUMNS =
  "id, invoice_id, description, quantity, unit_price_cents, amount_cents, position";

/** Raw snake_case shape PostgREST returns for an `invoices` row (+ embedded customer name). */
interface InvoiceRaw {
  id: string;
  workspace_id: string;
  customer_id: string | null;
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
  payment_methods: Json | null;
  public_token: string | null;
  sent_at: string | null;
  paid_at: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  created_at: string;
  updated_at: string;
  customers: { name: string } | null;
  /** Embedded merchant (workspace) name - the issuing business shown on the public page. */
  workspaces: { name: string } | null;
}

interface LineItemRaw {
  id: string;
  invoice_id: string;
  description: string;
  /** numeric(12,2) - the generated type says `number`, but PostgREST returns a STRING at
   *  runtime; `Number()` coerces either way (Number("2.5") === 2.5, Number(2.5) === 2.5). */
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  position: number;
}

/** Maps a snake_case PostgREST invoices row to the camelCase `InvoiceRow`. */
function toInvoiceRow(r: InvoiceRaw): InvoiceRow {
  return {
    id: branded<"InvoiceId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    customerId: r.customer_id ? branded<"CustomerId">(r.customer_id) : null,
    customerName: r.customers?.name ?? null,
    number: r.number,
    status: r.status as InvoiceStatus,
    issueDate: parsePgTimestamp(r.issue_date),
    dueDate: r.due_date ? parsePgTimestamp(r.due_date) : null,
    currency: r.currency,
    taxRate: r.tax_rate,
    pricesIncludeTax: r.prices_include_tax,
    subtotalCents: r.subtotal_cents,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    notes: r.notes,
    paymentMethods: r.payment_methods as unknown as PaymentMethods | null,
    publicToken: r.public_token,
    sentAt: r.sent_at ? parsePgTimestamp(r.sent_at) : null,
    paidAt: r.paid_at ? parsePgTimestamp(r.paid_at) : null,
    stripePaymentIntentId: r.stripe_payment_intent_id,
    stripeChargeId: r.stripe_charge_id,
    createdAt: parsePgTimestamp(r.created_at),
    updatedAt: parsePgTimestamp(r.updated_at),
  };
}

/** Maps a snake_case line-item row, coercing the `numeric` quantity string → number. */
function toLineItemRow(r: LineItemRaw): InvoiceLineItemRow {
  return {
    id: branded<"InvoiceLineItemId">(r.id),
    invoiceId: branded<"InvoiceId">(r.invoice_id),
    description: r.description,
    quantity: Number(r.quantity),
    unitPriceCents: r.unit_price_cents,
    amountCents: r.amount_cents,
    position: r.position,
  };
}

/** Format `{prefix}YYYY-NNNN` from a 1-based sequence. The prefix comes from the workspace row. */
function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}${year}-${String(seq).padStart(4, "0")}`;
}

/** Next workspace-unique invoice number for the given year (count existing + 1). Uses the
 *  workspace's configured `invoicePrefix` (default "INV-"). Changing the prefix resets the yearly
 *  sequence (the count is scoped to `${prefix}${year}-`). */
async function nextInvoiceNumber(
  workspaceId: WorkspaceId,
  year: number,
  prefix: string,
): Promise<string> {
  const supabase = getDataClient();
  const yearPrefix = `${prefix}${year}-`;
  // PostgREST has no COUNT(*) aggregate - use a head count (`head:true, count:"exact"`).
  const n = await unwrapCount(
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .like("number", `${yearPrefix}%`),
  );
  return formatInvoiceNumber(prefix, year, n + 1);
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
 * Create a draft invoice. The number is generated per workspace+year; on a rare unique
 * race (two concurrent creates pick the same seq), the insert throws and we retry up to
 * 3× (best-effort - a dedicated `sequences` table would be more robust; see limitations).
 */
export async function createInvoice(
  workspaceId: WorkspaceId,
  input: InvoiceInput,
  actorId: UserId,
): Promise<InvoiceId> {
  if (input.lineItems.length === 0) throw new Error("An invoice needs at least one line item.");
  await assertCustomerInWorkspace(workspaceId, input.customerId ?? null);

  const pricesIncludeTax = input.pricesIncludeTax ?? false;
  const totals = computeInvoiceTotals(input.lineItems, input.taxRate, { pricesIncludeTax });
  const year = new Date().getFullYear();
  const supabase = getDataClient();
  // The workspace row carries the configured invoice prefix + default currency (migration 0018).
  // Fall back to the schema defaults if the row is somehow missing.
  const workspace = await getWorkspace(workspaceId);
  const invoicePrefix = workspace?.invoicePrefix ?? "INV-";
  const defaultCurrency = workspace?.defaultCurrency ?? "AUD";

  // The number is generated per workspace+year; on a rare unique race (two concurrent
  // creates pick the same seq), the `create_invoice_with_lines` RPC's insert hits the
  // unique index and PostgREST returns `error.code === '23505'` → we retry (re-counting,
  // now seeing the committed row). The 3× retry stays in JS; the RPC is the atomic
  // insert (invoice + line items) + the unique-index guard.
  let attempts = 0;
  let lastErr: unknown;
  let invoiceId: string | null = null;
  let number = "";
  while (attempts < 3) {
    attempts += 1;
    number = await nextInvoiceNumber(workspaceId, year, invoicePrefix);
    const { data, error } = await rpc(supabase, "create_invoice_with_lines", {
      p_workspace_id: workspaceId,
      p_customer_id: input.customerId ?? null,
      p_number: number,
      p_issue_date: input.issueDate.toISOString(),
      p_due_date: input.dueDate ? input.dueDate.toISOString() : null,
      p_currency: input.currency ?? defaultCurrency,
      p_tax_rate: input.taxRate,
      p_prices_include_tax: pricesIncludeTax,
      p_subtotal_cents: totals.subtotalCents,
      p_tax_cents: totals.taxCents,
      p_total_cents: totals.totalCents,
      p_notes: input.notes ?? null,
      p_payment_methods:
        input.paymentMethods && input.paymentMethods.length > 0
          ? (input.paymentMethods as unknown as Json)
          : null,
      p_line_items: input.lineItems.map((it, i) => ({
        description: it.description,
        quantity: String(it.quantity),
        unit_price_cents: it.unitPriceCents,
        amount_cents: lineItemAmountCents(it.quantity, it.unitPriceCents),
        position: i,
      })),
    });
    if (error) {
      if (error.code === "23505") {
        lastErr = new Error(`PostgREST error [${error.code}]: ${error.message}`);
        continue;
      }
      throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
    }
    invoiceId = data;
    break;
  }
  if (!invoiceId) throw lastErr ?? new Error("Failed to generate a unique invoice number.");
  const id = branded<"InvoiceId">(invoiceId);

  // publishEvent/writeAudit run AFTER the rpc returns (a tiny non-atomic gap between the
  // row writes and the event/audit rows - acceptable: the event bus is best-effort and
  // consumers are idempotent). Previously these ran inside the Drizzle transaction.
  await publishEvent({
    type: "InvoiceCreated",
    workspaceId,
    actorUserId: actorId,
    entityType: "invoice",
    entityId: id,
    metadata: { number, totalCents: totals.totalCents },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "invoice.create",
    targetType: "invoice",
    targetId: id,
    metadata: {
      number,
      totalCents: totals.totalCents,
      lineItemCount: input.lineItems.length,
    },
  });
  return id;
}

/**
 * Update a draft invoice (line items are replaced; totals recomputed). Throws if the
 * invoice is not a draft or doesn't belong to the workspace.
 */
export async function updateInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  patch: InvoicePatch,
  actorId: UserId,
): Promise<void> {
  if (patch.lineItems !== undefined && patch.lineItems.length === 0) {
    throw new Error("An invoice needs at least one line item.");
  }
  await assertCustomerInWorkspace(workspaceId, patch.customerId ?? null);

  const supabase = getDataClient();
  // Read the current row OUTSIDE the rpc for the totals recompute (taxRate + inclusive
  // flag). The `update_invoice_with_lines` RPC re-validates draft status under a row
  // lock as the race guard, so a concurrent send between this read and the rpc is caught
  // by the rpc (it raises "Only draft invoices can be edited.").
  const current = await unwrapMaybe(
    supabase
      .from("invoices")
      .select("id, status, tax_rate, prices_include_tax")
      .eq("id", invoiceId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!current) throw new Error("Invoice not found.");
  if (current.status !== "draft") throw new Error("Only draft invoices can be edited.");

  const newLineItems = patch.lineItems;
  const newTaxRate = patch.taxRate;
  // The inclusive flag can be patched; otherwise carry the existing row's value so a
  // line-item/tax-rate edit on an inclusive invoice keeps treating prices as gross.
  const pricesIncludeTax = patch.pricesIncludeTax ?? current.prices_include_tax;
  // Recompute totals when either line items, the tax rate, or the inclusive flag change.
  // When only the tax rate/inclusive flag changes (no new line items), recompute from the
  // EXISTING line items so a tax-rate-only edit still updates totals correctly.
  let totals: { subtotalCents: number; taxCents: number; totalCents: number } | null = null;
  if (newLineItems !== undefined) {
    totals = computeInvoiceTotals(newLineItems, newTaxRate ?? current.tax_rate, {
      pricesIncludeTax,
    });
  } else if (newTaxRate !== undefined || patch.pricesIncludeTax !== undefined) {
    const existing = await unwrap(
      supabase
        .from("invoice_line_items")
        .select("quantity, unit_price_cents")
        .eq("invoice_id", invoiceId),
    );
    totals = computeInvoiceTotals(
      existing.map((e) => ({ quantity: Number(e.quantity), unitPriceCents: e.unit_price_cents })),
      newTaxRate ?? current.tax_rate,
      { pricesIncludeTax },
    );
  }

  // Build the patch as a snake_case jsonb object - only keys present change; a null value
  // sets the column to null. The RPC overlays this onto the locked row with
  // jsonb_populate_record (untouched columns keep their existing value), then optionally
  // replaces the line items. updated_at is set by the RPC, so it's omitted here.
  const set: Record<string, unknown> = {};
  if (patch.customerId !== undefined) set.customer_id = patch.customerId ?? null;
  if (patch.issueDate !== undefined) set.issue_date = patch.issueDate.toISOString();
  if (patch.dueDate !== undefined)
    set.due_date = patch.dueDate ? patch.dueDate.toISOString() : null;
  if (patch.currency !== undefined) set.currency = patch.currency;
  if (newTaxRate !== undefined) set.tax_rate = newTaxRate;
  if (patch.pricesIncludeTax !== undefined) set.prices_include_tax = patch.pricesIncludeTax;
  if (patch.notes !== undefined) set.notes = patch.notes ?? null;
  if (patch.paymentMethods !== undefined) {
    set.payment_methods =
      patch.paymentMethods && patch.paymentMethods.length > 0
        ? (patch.paymentMethods as unknown as Json)
        : null;
  }
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

  const { error } = await rpc(supabase, "update_invoice_with_lines", {
    p_workspace_id: workspaceId,
    p_invoice_id: invoiceId,
    p_set: set,
    p_line_items: lineItemsJson,
  });
  if (error) {
    throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  }

  // Draft edits are audit-only - not surfaced to the activity feed (too noisy). The feed
  // shows the lifecycle milestones (created/sent/paid/voided), not every edit.
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "invoice.update",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { fields: Object.keys(patch) },
  });
}

/** List invoices for a workspace, optionally filtered by status/search/customer. */
export async function listInvoices(
  workspaceId: WorkspaceId,
  opts?: { status?: InvoiceStatus; search?: string; customerId?: CustomerId; limit?: number },
): Promise<InvoiceRow[]> {
  const supabase = getDataClient();
  const limit = Math.min(opts?.limit ?? 100, 200);
  let query = supabase.from("invoices").select(INVOICE_COLUMNS).eq("workspace_id", workspaceId);
  if (opts?.status) query = query.eq("status", opts.status);
  if (opts?.customerId) query = query.eq("customer_id", opts.customerId);
  const search = opts?.search?.trim();
  if (search) {
    // PostgREST `or` can't reference embedded/foreign columns (PGRST100), so replicate the
    // Drizzle leftJoin + `or(ilike number, ilike customers.name, ilike customers.company)` in
    // two local-only steps: (1) find customer ids matching the name/company ILIKE (no
    // deleted_at filter - the original leftJoin didn't exclude soft-deleted customers);
    // (2) `or(number.ilike.X, customer_id.in.(ids))` on invoices. UUIDs are comma-safe in `in.(...)`.
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
  return rows.map((r) => toInvoiceRow(r as InvoiceRaw));
}

/**
 * Fetch a single invoice with its line items, scoped to the workspace. IDOR-safe -
 * returns null when the invoice belongs to another workspace.
 */
export async function getInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
): Promise<InvoiceWithItems | null> {
  const supabase = getDataClient();
  const inv = await unwrapMaybe(
    supabase
      .from("invoices")
      .select(INVOICE_COLUMNS)
      .eq("id", invoiceId)
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
  );
  if (!inv) return null;
  const invoice = toInvoiceRow(inv as InvoiceRaw);

  const itemRows = await unwrap(
    supabase
      .from("invoice_line_items")
      .select(LINE_ITEM_COLUMNS)
      .eq("invoice_id", invoiceId)
      .order("position", { ascending: true }),
  );
  return { ...invoice, lineItems: itemRows.map((r) => toLineItemRow(r as LineItemRaw)) };
}

/**
 * Transition an invoice to a new status, guarded by `allowedFrom` states. The
 * `.in("status", allowedFrom)` clause makes it atomic + idempotent: a concurrent
 * transition that already moved the invoice out of an allowed state makes this update
 * match zero rows (returns null → caller treats as no-op). Returns the invoice number for
 * audit, or null if nothing was transitioned.
 */
async function transition(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  to: InvoiceStatus,
  allowedFrom: InvoiceStatus[],
  set: Partial<{
    sentAt: Date;
    paidAt: Date;
    publicToken: string;
    stripePaymentIntentId: string;
    stripeChargeId: string;
  }>,
): Promise<{ number: string } | null> {
  const supabase = getDataClient();
  // Explicit column-keyed shape (not a loose Record<string, unknown>) - the generated
  // `.update()` type rejects an `unknown` index signature.
  const update: {
    status: InvoiceStatus;
    updated_at: string;
    sent_at?: string;
    paid_at?: string;
    public_token?: string;
    stripe_payment_intent_id?: string;
    stripe_charge_id?: string | null;
  } = { status: to, updated_at: new Date().toISOString() };
  if (set.sentAt) update.sent_at = set.sentAt.toISOString();
  if (set.paidAt) update.paid_at = set.paidAt.toISOString();
  if (set.publicToken !== undefined) update.public_token = set.publicToken;
  if (set.stripePaymentIntentId !== undefined)
    update.stripe_payment_intent_id = set.stripePaymentIntentId;
  if (set.stripeChargeId !== undefined) update.stripe_charge_id = set.stripeChargeId ?? null;

  const rows = await unwrap(
    supabase
      .from("invoices")
      .update(update)
      .eq("id", invoiceId)
      .eq("workspace_id", workspaceId)
      .in("status", allowedFrom)
      .select("id, number"),
  );
  const row = rows[0];
  return row ? { number: row.number } : null;
}

/**
 * Fetch the email-render context for one invoice (join customers for the email + name). Used to
 * enrich `InvoiceSent` / `InvoicePaid` event metadata so the notifications platform can render
 * an email without importing the invoices module (cross-module side effects go via the bus).
 * Returns null if the invoice isn't found or has no `publicToken` (a draft has none → no email).
 * `customerEmail` / `customerName` are null for walk-in customers (no customer row).
 */
async function fetchInvoiceEmailContext(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
): Promise<InvoiceEmailMeta | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("invoices")
      .select(
        "number, total_cents, currency, public_token, due_date, customer_id, customers!left ( email, name )",
      )
      .eq("id", invoiceId)
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
    dueDate: row.due_date ? parsePgTimestamp(row.due_date) : null,
    customerId: row.customer_id ? branded<"CustomerId">(row.customer_id) : null,
    customerEmail: row.customers?.email ?? null,
    customerName: row.customers?.name ?? null,
  };
}

/**
 * Send a draft invoice: `draft → sent`, sets `sentAt` + a random `publicToken` (for the
 * 5b public page). 5c enriches the `InvoiceSent` event with the email-render context so the
 * notifications platform can email the customer. Returns false if the invoice wasn't a draft
 * (already sent / voided / not found) - idempotent.
 */
export async function sendInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  actorId: UserId,
): Promise<boolean> {
  const publicToken = crypto.randomUUID();
  const result = await transition(workspaceId, invoiceId, "sent", ["draft"], {
    sentAt: new Date(),
    publicToken,
  });
  if (!result) return false;
  const ctx = await fetchInvoiceEmailContext(workspaceId, invoiceId);
  await publishEvent({
    type: "InvoiceSent",
    workspaceId,
    actorUserId: actorId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: ctx ?? { number: result.number, publicToken },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "invoice.send",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { number: result.number },
  });
  return true;
}

/**
 * Mark a sent invoice paid (manual / offline payment - no Stripe in 5a): `sent → paid`,
 * sets `paidAt`. Returns false if it wasn't sent (or not found) - idempotent via the
 * atomic `transition`. 5b augments this with the Stripe webhook path (idempotent on
 * payment intent id).
 */
export async function markInvoicePaid(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  actorId: UserId,
): Promise<boolean> {
  const result = await transition(workspaceId, invoiceId, "paid", ["sent"], { paidAt: new Date() });
  if (!result) return false;
  const ctx = await fetchInvoiceEmailContext(workspaceId, invoiceId);
  await publishEvent({
    type: "InvoicePaid",
    workspaceId,
    actorUserId: actorId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: ctx ? { ...ctx, source: "manual" } : { number: result.number, source: "manual" },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "invoice.markPaid",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { number: result.number, source: "manual" },
  });
  return true;
}

/** Void a draft or sent invoice: `draft|sent → void`. Returns false if not in an allowed
 *  state or not found - idempotent via the atomic `transition`. */
export async function voidInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  actorId: UserId,
): Promise<boolean> {
  const result = await transition(workspaceId, invoiceId, "void", ["draft", "sent"], {});
  if (!result) return false;
  await publishEvent({
    type: "InvoiceVoided",
    workspaceId,
    actorUserId: actorId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { number: result.number },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "invoice.void",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { number: result.number },
  });
  return true;
}

/**
 * Hard-delete a draft invoice (cascades line items). Only drafts - a sent/paid/voided
 * invoice is never deleted (the audit trail + history are preserved). Returns false if
 * not a draft or not found.
 */
export async function deleteInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  actorId: UserId,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("invoices")
      .delete()
      .eq("id", invoiceId)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .select("id, number"),
  );
  const row = rows[0];
  if (!row) return false;
  // Draft delete is audit-only (the draft was never sent, so no activity-feed milestone).
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "invoice.delete",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { number: row.number },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Phase 5b - public payment page + Stripe reconcile + overdue job
// ---------------------------------------------------------------------------

/**
 * Sanitized invoice shape for the **public** payment page. Deliberately omits all
 * workspace-internal ids (`workspaceId`, internal `customerId`, internal invoice/line-item
 * ids) per the design-system security spec - the public HTML must only expose what the
 * customer needs to pay. `stripeChargeId` is the receipt reference shown on the paid screen.
 */
export interface PublicInvoiceView {
  number: string;
  status: InvoiceStatus;
  customerName: string | null;
  /** Issuing business (workspace) name - shown as the dominant brand on the public invoice page. */
  merchantName: string | null;
  issueDate: Date;
  dueDate: Date | null;
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
  sentAt: Date | null;
  paidAt: Date | null;
  /** Receipt reference on the paid confirmation screen; null until payment succeeds. */
  stripeChargeId: string | null;
  /** Resolved payment methods to show the customer (invoice override → workspace default). */
  paymentMethods: PaymentMethods;
}

/**
 * Look up an invoice by its public token for the `/i/[token]` page. Returns null if the
 * token doesn't match OR the invoice is still a draft (a draft was never sent → not
 * publicly payable). The partial unique index on `publicToken` makes this lookup indexed.
 * No `workspaceId` param - the token IS the credential (unguessable 122-bit random).
 */
export async function getInvoiceByPublicToken(token: string): Promise<PublicInvoiceView | null> {
  const supabase = getDataClient();
  const inv = await unwrapMaybe(
    supabase
      .from("invoices")
      .select(INVOICE_COLUMNS)
      .eq("public_token", token)
      .limit(1)
      .maybeSingle(),
  );
  if (!inv) return null;
  const r = inv as InvoiceRaw;
  if (r.status === "draft") return null;

  const [itemRows, workspace] = await Promise.all([
    unwrap(
      supabase
        .from("invoice_line_items")
        .select(LINE_ITEM_COLUMNS)
        .eq("invoice_id", r.id)
        .order("position", { ascending: true }),
    ),
    getWorkspace(branded<"WorkspaceId">(r.workspace_id)),
  ]);

  // Build the public view explicitly - never spread the internal row (it carries internal
  // ids, private `notes`, `publicToken`, `stripePaymentIntentId`, timestamps). Only the
  // fields the customer needs to pay leak to the public HTML.
  return {
    number: r.number,
    status: r.status as InvoiceStatus,
    customerName: r.customers?.name ?? null,
    merchantName: r.workspaces?.name ?? null,
    issueDate: parsePgTimestamp(r.issue_date),
    dueDate: r.due_date ? parsePgTimestamp(r.due_date) : null,
    currency: r.currency,
    taxRate: r.tax_rate,
    pricesIncludeTax: r.prices_include_tax,
    subtotalCents: r.subtotal_cents,
    taxCents: r.tax_cents,
    totalCents: r.total_cents,
    lineItems: itemRows.map((it) => {
      const li = it as LineItemRaw;
      return {
        description: li.description,
        quantity: Number(li.quantity),
        unitPriceCents: li.unit_price_cents,
        amountCents: li.amount_cents,
      };
    }),
    sentAt: r.sent_at ? parsePgTimestamp(r.sent_at) : null,
    paidAt: r.paid_at ? parsePgTimestamp(r.paid_at) : null,
    stripeChargeId: r.stripe_charge_id,
    paymentMethods: resolveInvoicePaymentMethods(
      r.payment_methods,
      workspace?.paymentMethods ?? null,
    ),
  };
}

/**
 * Record a customer view of a sent invoice: `sent → viewed`, idempotent. Returns true if the
 * status changed (first view), false if already viewed / not sent (no-op, no duplicate event).
 * The `transition` `.in("status", ["sent"])` clause makes a concurrent double-view
 * race-safe - only one wins. The workspaceId is resolved internally and never returned.
 */
export async function markInvoiceViewed(token: string): Promise<boolean> {
  const supabase = getDataClient();
  // Resolve workspaceId + id internally for the event + atomic guard.
  const found = await unwrapMaybe(
    supabase
      .from("invoices")
      .select("id, workspace_id")
      .eq("public_token", token)
      .limit(1)
      .maybeSingle(),
  );
  if (!found) return false;
  const workspaceId = branded<"WorkspaceId">(found.workspace_id);
  const invoiceId = branded<"InvoiceId">(found.id);

  const result = await transition(workspaceId, invoiceId, "viewed", ["sent"], {});
  if (!result) return false;
  await publishEvent({
    type: "InvoiceViewed",
    workspaceId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { number: result.number },
  });
  await writeAudit({
    workspaceId,
    actorUserId: undefined,
    action: "invoice.viewed",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { number: result.number, source: "public_page" },
  });
  return true;
}

/**
 * Mark an invoice paid by a Stripe payment (5b webhook path): `sent|viewed|overdue → paid`,
 * sets `paidAt` + `stripePaymentIntentId` + `stripeChargeId`. Idempotent - the atomic
 * `transition` matches zero rows if the invoice is already paid (or not found / voided),
 * returning false without re-publishing. Distinct from the manual `markInvoicePaid` (no
 * Stripe ids, manual source). Returns true if this call performed the transition.
 */
export async function markInvoicePaidByStripe(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  paymentIntentId: string,
  chargeId: string | null,
): Promise<boolean> {
  const result = await transition(workspaceId, invoiceId, "paid", ["sent", "viewed", "overdue"], {
    paidAt: new Date(),
    stripePaymentIntentId: paymentIntentId,
    stripeChargeId: chargeId ?? undefined,
  });
  if (!result) return false;
  const ctx = await fetchInvoiceEmailContext(workspaceId, invoiceId);
  await publishEvent({
    type: "InvoicePaid",
    workspaceId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: ctx
      ? { ...ctx, source: "stripe", paymentIntentId }
      : { number: result.number, source: "stripe", paymentIntentId },
  });
  await writeAudit({
    workspaceId,
    actorUserId: undefined,
    action: "invoice.markPaid",
    targetType: "invoice",
    targetId: invoiceId,
    metadata: { number: result.number, source: "stripe", paymentIntentId, chargeId },
  });
  return true;
}

/**
 * Flip all sent/viewed invoices past their due date to `overdue` (5b cron job). One bulk
 * atomic update guarded by `.in("status", ["sent","viewed"])` + `due_date < now` + `due_date
 * is not null`. Publishes `InvoiceOverdue` per flipped invoice + writes audit. Returns the
 * count flipped. `now` is a param so tests can pass a fixed timestamp.
 */
export async function markOverdueInvoices(now: Date = new Date()): Promise<number> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("invoices")
      .update({ status: "overdue", updated_at: now.toISOString() })
      .in("status", ["sent", "viewed"])
      .lt("due_date", now.toISOString())
      .not("due_date", "is", null)
      .select("id, workspace_id, number"),
  );

  if (rows.length === 0) return 0;

  // One batched select to fetch the email-render context (join customers) for every flipped
  // invoice - keeps the cron at one extra query rather than N (nightly, not hot, but cheap).
  const ids = rows.map((r) => r.id);
  const ctxRows = await unwrap(
    supabase
      .from("invoices")
      .select(
        "id, workspace_id, number, total_cents, currency, public_token, due_date, customers!left ( email, name )",
      )
      .in("id", ids),
  );
  const ctxById = new Map(ctxRows.map((r) => [r.id, r]));

  // Publish events + audit per flipped invoice (best-effort, sequential - cron isn't hot).
  for (const row of rows) {
    const ctx = ctxById.get(row.id);
    const workspaceId = branded<"WorkspaceId">(row.workspace_id);
    const invoiceId = branded<"InvoiceId">(row.id);
    await publishEvent({
      type: "InvoiceOverdue",
      workspaceId,
      entityType: "invoice",
      entityId: invoiceId,
      metadata: ctx?.public_token
        ? {
            number: ctx.number,
            totalCents: ctx.total_cents,
            currency: ctx.currency,
            publicToken: ctx.public_token,
            dueDate: ctx.due_date ? parsePgTimestamp(ctx.due_date) : null,
            customerEmail: ctx.customers?.email ?? null,
            customerName: ctx.customers?.name ?? null,
          }
        : { number: row.number },
    });
    await writeAudit({
      workspaceId,
      actorUserId: undefined,
      action: "invoice.overdue",
      targetType: "invoice",
      targetId: invoiceId,
      metadata: { number: row.number, source: "cron" },
    });
  }
  return rows.length;
}

/**
 * Internal payment context for the public `createInvoicePaymentIntentAction` (server-only,
 * never sent to the client). Returns the fields needed to create/reuse a Stripe
 * PaymentIntent. Returns null if the token doesn't match or the invoice isn't payable
 * (draft / void / already paid).
 */
export interface InvoicePaymentContext {
  invoiceId: InvoiceId;
  workspaceId: WorkspaceId;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  stripePaymentIntentId: string | null;
}

export async function getInvoicePaymentContext(
  token: string,
): Promise<InvoicePaymentContext | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("invoices")
      .select("id, workspace_id, total_cents, currency, status, stripe_payment_intent_id")
      .eq("public_token", token)
      .limit(1)
      .maybeSingle(),
  );
  if (!row) return null;
  if (row.status === "draft" || row.status === "void" || row.status === "paid") return null;
  return {
    invoiceId: branded<"InvoiceId">(row.id),
    workspaceId: branded<"WorkspaceId">(row.workspace_id),
    totalCents: row.total_cents,
    currency: row.currency,
    status: row.status as InvoiceStatus,
    stripePaymentIntentId: row.stripe_payment_intent_id,
  };
}

/**
 * Atomically claim a PaymentIntent id for an invoice: `UPDATE … SET stripe_payment_intent_id
 * = piId WHERE id = invoice.id AND stripe_payment_intent_id IS NULL`. Returns true if this
 * call won the claim (1 row updated), false if another request already claimed it (0 rows).
 * The partial unique index is the real guard; this is the race-free claim primitive.
 */
export async function claimPaymentIntentId(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  paymentIntentId: string,
): Promise<boolean> {
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("invoices")
      .update({ stripe_payment_intent_id: paymentIntentId, updated_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .eq("workspace_id", workspaceId)
      // only if not yet claimed
      .is("stripe_payment_intent_id", null)
      .select("id"),
  );
  return Boolean(rows[0]);
}

// Re-export for callers that need the totals math directly (e.g. the create form's
// live preview). Keeps the barrel minimal.
export { computeInvoiceTotals, lineItemAmountCents } from "./totals";

// Re-export the pure dashboard aggregator (Phase 9) so the dashboard loader can call it via
// `@/modules/invoices` without importing `./calc` directly.
export {
  summarizeInvoices,
  type InvoiceSummary,
  type InvoiceSummaryInput,
  type MonthlyInvoicePoint,
} from "./calc";
