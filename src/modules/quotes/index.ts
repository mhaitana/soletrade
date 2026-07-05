import "server-only";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  like,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { getDb } from "@/server/db";
import { quotes, quoteLineItems, customers } from "@/server/db/schema";
import { getCustomer } from "@/platform/customers";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { computeLineItemTotals, lineItemAmountCents } from "@/shared/utils/totals";
import type { QuoteStatus } from "@/server/db/schema/enums";
import type {
  CustomerId,
  InvoiceId,
  QuoteId,
  QuoteLineItemId,
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
 * converted` (terminal). All queries filter `eq(quotes.workspaceId, workspaceId)` — never
 * trust a client workspace id; the caller resolves it from the session
 * (`requireWorkspaceContext`). Money is integer cents; totals are denormalized onto the
 * quote row via the pure `computeLineItemTotals` so a sent quote's history is preserved.
 * Quote numbers (`QUO-YYYY-NNNN`) are workspace-unique per calendar year.
 */

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface QuoteInput {
  customerId?: CustomerId | null;
  issueDate: Date;
  validUntil?: Date | null;
  currency?: string;
  /** Integer percent (10 = 10% GST). */
  taxRate: number;
  notes?: string | null;
  lineItems: LineItemInput[];
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
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
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

export interface QuoteWithItems extends QuoteRow {
  lineItems: QuoteLineItemRow[];
}

const selectQuote = {
  id: quotes.id,
  workspaceId: quotes.workspaceId,
  customerId: quotes.customerId,
  number: quotes.number,
  status: quotes.status,
  issueDate: quotes.issueDate,
  validUntil: quotes.validUntil,
  currency: quotes.currency,
  taxRate: quotes.taxRate,
  subtotalCents: quotes.subtotalCents,
  taxCents: quotes.taxCents,
  totalCents: quotes.totalCents,
  notes: quotes.notes,
  publicToken: quotes.publicToken,
  sentAt: quotes.sentAt,
  acceptedAt: quotes.acceptedAt,
  declinedAt: quotes.declinedAt,
  convertedAt: quotes.convertedAt,
  convertedInvoiceId: quotes.convertedInvoiceId,
  createdAt: quotes.createdAt,
  updatedAt: quotes.updatedAt,
} as const;

const selectLineItem = {
  id: quoteLineItems.id,
  quoteId: quoteLineItems.quoteId,
  description: quoteLineItems.description,
  quantity: quoteLineItems.quantity,
  unitPriceCents: quoteLineItems.unitPriceCents,
  amountCents: quoteLineItems.amountCents,
  position: quoteLineItems.position,
} as const;

/** Resolved shape of a `select(selectLineItem)` row (numeric → string). */
type LineItemSelectRow = {
  id: QuoteLineItemId;
  quoteId: QuoteId;
  description: string;
  quantity: string;
  unitPriceCents: number;
  amountCents: number;
  position: number;
};

/** numeric(12,2) comes back as a string; coerce to a JS number for the API. */
function mapLineItem(row: LineItemSelectRow): QuoteLineItemRow {
  return { ...row, quantity: Number(row.quantity) };
}

/** True if a thrown error is a Postgres unique-violation (code 23505). Drizzle wraps the
 *  driver error in `DrizzleQueryError.cause`, so check both layers + the constraint name. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return (
    e?.code === "23505" || e?.cause?.code === "23505" || /unique constraint/i.test(e?.message ?? "")
  );
}

/** Format `QUO-YYYY-NNNN` from a 1-based sequence. */
function formatQuoteNumber(year: number, seq: number): string {
  return `QUO-${year}-${String(seq).padStart(4, "0")}`;
}

/** Next workspace-unique quote number for the given year (count existing + 1). */
async function nextQuoteNumber(
  db: ReturnType<typeof getDb>,
  workspaceId: WorkspaceId,
  year: number,
): Promise<string> {
  const prefix = `QUO-${year}-`;
  const rows = await db
    .select({ n: count() })
    .from(quotes)
    .where(and(eq(quotes.workspaceId, workspaceId), like(quotes.number, `${prefix}%`)));
  const seq = (rows[0]?.n ?? 0) + 1;
  return formatQuoteNumber(year, seq);
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

  const totals = computeLineItemTotals(input.lineItems, input.taxRate);
  const year = new Date().getFullYear();
  const db = getDb();

  let attempts = 0;
  let lastErr: unknown;
  while (attempts < 3) {
    attempts += 1;
    try {
      const number = await nextQuoteNumber(db, workspaceId, year);
      return await db.transaction(async (tx) => {
        const qRows = await tx
          .insert(quotes)
          .values({
            workspaceId,
            customerId: input.customerId ?? null,
            number,
            status: "draft",
            issueDate: input.issueDate,
            validUntil: input.validUntil ?? null,
            currency: input.currency ?? "AUD",
            taxRate: input.taxRate,
            subtotalCents: totals.subtotalCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            notes: input.notes ?? null,
          })
          .returning({ id: quotes.id });
        const q = qRows[0];
        if (!q) throw new Error("Failed to create quote.");

        if (input.lineItems.length > 0) {
          await tx.insert(quoteLineItems).values(
            input.lineItems.map((it, i) => ({
              quoteId: q.id,
              workspaceId,
              description: it.description,
              quantity: String(it.quantity),
              unitPriceCents: it.unitPriceCents,
              amountCents: lineItemAmountCents(it.quantity, it.unitPriceCents),
              position: i,
            })),
          );
        }

        await writeAudit({
          workspaceId,
          actorUserId: actorId,
          action: "quote.create",
          targetType: "quote",
          targetId: q.id,
          metadata: {
            number,
            totalCents: totals.totalCents,
            lineItemCount: input.lineItems.length,
          },
        });
        return q.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Failed to generate a unique quote number.");
}

/**
 * Update a draft quote (line items are replaced; totals recomputed). Throws if the quote
 * is not a draft or doesn't belong to the workspace.
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

  const db = getDb();
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: quotes.id, status: quotes.status, taxRate: quotes.taxRate })
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.workspaceId, workspaceId)))
      .limit(1);
    const row = current[0];
    if (!row) throw new Error("Quote not found.");
    if (row.status !== "draft") throw new Error("Only draft quotes can be edited.");

    const newLineItems = patch.lineItems;
    const newTaxRate = patch.taxRate;
    let totals: { subtotalCents: number; taxCents: number; totalCents: number } | null = null;
    if (newLineItems !== undefined) {
      totals = computeLineItemTotals(newLineItems, newTaxRate ?? row.taxRate);
    } else if (newTaxRate !== undefined) {
      const existing = await tx
        .select({
          quantity: quoteLineItems.quantity,
          unitPriceCents: quoteLineItems.unitPriceCents,
        })
        .from(quoteLineItems)
        .where(eq(quoteLineItems.quoteId, quoteId));
      totals = computeLineItemTotals(
        existing.map((e) => ({ quantity: Number(e.quantity), unitPriceCents: e.unitPriceCents })),
        newTaxRate,
      );
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.customerId !== undefined) set.customerId = patch.customerId ?? null;
    if (patch.issueDate !== undefined) set.issueDate = patch.issueDate;
    if (patch.validUntil !== undefined) set.validUntil = patch.validUntil ?? null;
    if (patch.currency !== undefined) set.currency = patch.currency;
    if (newTaxRate !== undefined) set.taxRate = newTaxRate;
    if (patch.notes !== undefined) set.notes = patch.notes ?? null;
    if (totals) {
      set.subtotalCents = totals.subtotalCents;
      set.taxCents = totals.taxCents;
      set.totalCents = totals.totalCents;
    }

    await tx.update(quotes).set(set).where(eq(quotes.id, quoteId));

    if (newLineItems !== undefined) {
      await tx.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
      if (newLineItems.length > 0) {
        await tx.insert(quoteLineItems).values(
          newLineItems.map((it, i) => ({
            quoteId,
            workspaceId,
            description: it.description,
            quantity: String(it.quantity),
            unitPriceCents: it.unitPriceCents,
            amountCents: lineItemAmountCents(it.quantity, it.unitPriceCents),
            position: i,
          })),
        );
      }
    }
  });

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
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 200);
  const conditions: (SQL | undefined)[] = [eq(quotes.workspaceId, workspaceId)];
  if (opts?.status) conditions.push(eq(quotes.status, opts.status));
  if (opts?.customerId) conditions.push(eq(quotes.customerId, opts.customerId));
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(ilike(quotes.number, term), ilike(customers.name, term), ilike(customers.company, term)),
    );
  }

  const rows = await db
    .select({
      ...selectQuote,
      customerName: customers.name,
    })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(quotes.issueDate), desc(quotes.createdAt))
    .limit(limit);

  return rows.map(({ customerName, ...q }) => ({ ...q, customerName: customerName ?? null }));
}

/**
 * Fetch a single quote with its line items, scoped to the workspace. IDOR-safe —
 * returns null when the quote belongs to another workspace.
 */
export async function getQuote(
  workspaceId: WorkspaceId,
  quoteId: QuoteId,
): Promise<QuoteWithItems | null> {
  const db = getDb();
  const qRows = await db
    .select({ ...selectQuote, customerName: customers.name })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .where(and(eq(quotes.id, quoteId), eq(quotes.workspaceId, workspaceId)))
    .limit(1);
  const q = qRows[0];
  if (!q) return null;

  const itemRows = await db
    .select(selectLineItem)
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, quoteId))
    .orderBy(quoteLineItems.position);

  const { customerName, ...rest } = q;
  return {
    ...rest,
    customerName: customerName ?? null,
    lineItems: itemRows.map(mapLineItem),
  };
}

/**
 * Transition a quote to a new status, guarded by `allowedFrom` states. The
 * `inArray(quotes.status, allowedFrom)` clause makes it atomic + idempotent: a
 * concurrent transition that already moved the quote out of an allowed state makes this
 * update match zero rows (returns null → caller treats as no-op). Returns the quote
 * number + convertedInvoiceId for audit/event, or null if nothing was transitioned.
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
  const db = getDb();
  const rows = await db
    .update(quotes)
    .set({ status: to, updatedAt: new Date(), ...set })
    .where(
      and(
        eq(quotes.id, quoteId),
        eq(quotes.workspaceId, workspaceId),
        inArray(quotes.status, allowedFrom),
      ),
    )
    .returning({ id: quotes.id, number: quotes.number });
  return rows[0] ? { number: rows[0].number } : null;
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
  const db = getDb();
  const rows = await db
    .select({
      number: quotes.number,
      totalCents: quotes.totalCents,
      currency: quotes.currency,
      publicToken: quotes.publicToken,
      validUntil: quotes.validUntil,
      customerId: quotes.customerId,
      customerEmail: customers.email,
      customerName: customers.name,
    })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .where(and(eq(quotes.id, quoteId), eq(quotes.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.publicToken) return null;
  return {
    number: row.number,
    totalCents: row.totalCents,
    currency: row.currency,
    publicToken: row.publicToken,
    validUntil: row.validUntil,
    customerId: row.customerId,
    customerEmail: row.customerEmail,
    customerName: row.customerName,
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
  const db = getDb();
  const rows = await db
    .select({
      number: quotes.number,
      totalCents: quotes.totalCents,
      currency: quotes.currency,
      customerEmail: customers.email,
      customerName: customers.name,
    })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .where(and(eq(quotes.id, quoteId), eq(quotes.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    number: row.number,
    totalCents: row.totalCents,
    currency: row.currency,
    customerEmail: row.customerEmail,
    customerName: row.customerName,
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
  const db = getDb();
  const rows = await db
    .delete(quotes)
    .where(
      and(eq(quotes.id, quoteId), eq(quotes.workspaceId, workspaceId), eq(quotes.status, "draft")),
    )
    .returning({ id: quotes.id, number: quotes.number });
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
  const db = getDb();
  const qRows = await db
    .select({ ...selectQuote, customerName: customers.name })
    .from(quotes)
    .leftJoin(customers, eq(quotes.customerId, customers.id))
    .where(eq(quotes.publicToken, token))
    .limit(1);
  const q = qRows[0];
  if (!q) return null;
  if (
    q.status === "draft" ||
    q.status === "expired" ||
    q.status === "converted" ||
    q.status === "declined"
  ) {
    return null;
  }

  const itemRows = await db
    .select(selectLineItem)
    .from(quoteLineItems)
    .where(eq(quoteLineItems.quoteId, q.id))
    .orderBy(quoteLineItems.position);

  return {
    number: q.number,
    status: q.status,
    customerName: q.customerName ?? null,
    issueDate: q.issueDate,
    validUntil: q.validUntil,
    currency: q.currency,
    taxRate: q.taxRate,
    subtotalCents: q.subtotalCents,
    taxCents: q.taxCents,
    totalCents: q.totalCents,
    lineItems: itemRows.map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unitPriceCents: it.unitPriceCents,
      amountCents: it.amountCents,
    })),
    sentAt: q.sentAt,
    acceptedAt: q.acceptedAt,
    declinedAt: q.declinedAt,
    convertedInvoiceId: q.convertedInvoiceId,
  };
}

/**
 * Record a customer view of a sent quote: `sent → viewed`, idempotent. Returns true if the
 * status changed (first view), false if already viewed / not sent (no-op, no duplicate event).
 * The `transition` `inArray(quotes.status, ["sent"])` clause makes a concurrent double-view
 * race-safe — only one wins. The workspaceId is resolved internally and never returned.
 */
export async function markQuoteViewed(token: string): Promise<boolean> {
  const db = getDb();
  const found = await db
    .select({ id: quotes.id, workspaceId: quotes.workspaceId })
    .from(quotes)
    .where(eq(quotes.publicToken, token))
    .limit(1);
  const row = found[0];
  if (!row) return false;

  const result = await transition(row.workspaceId, row.id, "viewed", ["sent"], {});
  if (!result) return false;
  await publishEvent({
    type: "QuoteViewed",
    workspaceId: row.workspaceId,
    entityType: "quote",
    entityId: row.id,
    metadata: { number: result.number },
  });
  await writeAudit({
    workspaceId: row.workspaceId,
    actorUserId: undefined,
    action: "quote.viewed",
    targetType: "quote",
    targetId: row.id,
    metadata: { number: result.number, source: "public_page" },
  });
  return true;
}

/**
 * Customer accepts a quote (public action): `sent|viewed → accepted`, sets `acceptedAt`.
 * Publishes `QuoteAccepted` enriched with merchant-notification metadata so the
 * notifications platform can email workspace members. Returns false if the quote isn't
 * in an allowed state or not found — idempotent via the atomic `transition`.
 */
export async function acceptQuote(token: string): Promise<boolean> {
  const db = getDb();
  const found = await db
    .select({ id: quotes.id, workspaceId: quotes.workspaceId })
    .from(quotes)
    .where(eq(quotes.publicToken, token))
    .limit(1);
  const row = found[0];
  if (!row) return false;

  const result = await transition(row.workspaceId, row.id, "accepted", ["sent", "viewed"], {
    acceptedAt: new Date(),
  });
  if (!result) return false;
  const meta = await fetchQuoteMerchantMeta(row.workspaceId, row.id);
  await publishEvent({
    type: "QuoteAccepted",
    workspaceId: row.workspaceId,
    entityType: "quote",
    entityId: row.id,
    metadata: meta ?? { number: result.number },
  });
  await writeAudit({
    workspaceId: row.workspaceId,
    actorUserId: undefined,
    action: "quote.accept",
    targetType: "quote",
    targetId: row.id,
    metadata: { number: result.number, source: "public_page" },
  });
  return true;
}

/**
 * Customer declines a quote (public action): `sent|viewed → declined`, sets `declinedAt`.
 * Publishes `QuoteDeclined` enriched with merchant-notification metadata. Returns false if
 * the quote isn't in an allowed state or not found — idempotent. No reason text captured
 * this phase (simple decline per the user decision).
 */
export async function declineQuote(token: string): Promise<boolean> {
  const db = getDb();
  const found = await db
    .select({ id: quotes.id, workspaceId: quotes.workspaceId })
    .from(quotes)
    .where(eq(quotes.publicToken, token))
    .limit(1);
  const row = found[0];
  if (!row) return false;

  const result = await transition(row.workspaceId, row.id, "declined", ["sent", "viewed"], {
    declinedAt: new Date(),
  });
  if (!result) return false;
  const meta = await fetchQuoteMerchantMeta(row.workspaceId, row.id);
  await publishEvent({
    type: "QuoteDeclined",
    workspaceId: row.workspaceId,
    entityType: "quote",
    entityId: row.id,
    metadata: meta ?? { number: result.number },
  });
  await writeAudit({
    workspaceId: row.workspaceId,
    actorUserId: undefined,
    action: "quote.decline",
    targetType: "quote",
    targetId: row.id,
    metadata: { number: result.number, source: "public_page" },
  });
  return true;
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
 * One bulk atomic update guarded by `inArray(status, ["sent","viewed"])` +
 * `valid_until < now` + `valid_until is not null`. Accepted quotes don't expire (they're
 * heading to conversion). Publishes `QuoteExpired` per flipped quote + writes audit
 * (activity-feed only — no email, mirrors `InvoiceViewed`). Returns the count flipped.
 * `now` is a param so tests can pass a fixed timestamp.
 */
export async function markExpiredQuotes(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const rows = await db
    .update(quotes)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        inArray(quotes.status, ["sent", "viewed"]),
        isNotNull(quotes.validUntil),
        lt(quotes.validUntil, now),
      ),
    )
    .returning({ id: quotes.id, workspaceId: quotes.workspaceId, number: quotes.number });

  if (rows.length === 0) return 0;

  for (const row of rows) {
    await publishEvent({
      type: "QuoteExpired",
      workspaceId: row.workspaceId,
      entityType: "quote",
      entityId: row.id,
      metadata: { number: row.number },
    });
    await writeAudit({
      workspaceId: row.workspaceId,
      actorUserId: undefined,
      action: "quote.expired",
      targetType: "quote",
      targetId: row.id,
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
