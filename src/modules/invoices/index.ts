import "server-only";
import { and, count, desc, eq, ilike, inArray, like, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { invoices, invoiceLineItems, customers } from "@/server/db/schema";
import { getCustomer } from "@/platform/customers";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { computeInvoiceTotals, lineItemAmountCents } from "./totals";
import type { InvoiceStatus } from "@/server/db/schema/enums";
import type {
  CustomerId,
  InvoiceId,
  InvoiceLineItemId,
  UserId,
  WorkspaceId,
} from "@/shared/types/ids";

/**
 * Invoices module service (Phase 5). Workspace-scoped CRUD + status transitions.
 * All queries filter `eq(invoices.workspaceId, workspaceId)` — never trust a client
 * workspace id; the caller resolves it from the session (`requireWorkspaceContext`).
 *
 * Status flow (5a): `draft → sent → paid | void`. `viewed`/`overdue` are unreachable
 * until 5b (public page + reminder job). Money is integer cents; totals are denormalized
 * onto the invoice row via the pure `computeInvoiceTotals` so a sent invoice's history is
 * preserved. Invoice numbers (`INV-YYYY-NNNN`) are workspace-unique per calendar year.
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
  notes?: string | null;
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
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
  publicToken: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
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

const selectInvoice = {
  id: invoices.id,
  workspaceId: invoices.workspaceId,
  customerId: invoices.customerId,
  number: invoices.number,
  status: invoices.status,
  issueDate: invoices.issueDate,
  dueDate: invoices.dueDate,
  currency: invoices.currency,
  taxRate: invoices.taxRate,
  subtotalCents: invoices.subtotalCents,
  taxCents: invoices.taxCents,
  totalCents: invoices.totalCents,
  notes: invoices.notes,
  publicToken: invoices.publicToken,
  sentAt: invoices.sentAt,
  paidAt: invoices.paidAt,
  createdAt: invoices.createdAt,
  updatedAt: invoices.updatedAt,
} as const;

const selectLineItem = {
  id: invoiceLineItems.id,
  invoiceId: invoiceLineItems.invoiceId,
  description: invoiceLineItems.description,
  quantity: invoiceLineItems.quantity,
  unitPriceCents: invoiceLineItems.unitPriceCents,
  amountCents: invoiceLineItems.amountCents,
  position: invoiceLineItems.position,
} as const;

/** Resolved shape of a `select(selectLineItem)` row (numeric → string). */
type LineItemSelectRow = {
  id: InvoiceLineItemId;
  invoiceId: InvoiceId;
  description: string;
  quantity: string;
  unitPriceCents: number;
  amountCents: number;
  position: number;
};

/** numeric(12,2) comes back as a string; coerce to a JS number for the API. */
function mapLineItem(row: LineItemSelectRow): InvoiceLineItemRow {
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

/** Format `INV-YYYY-NNNN` from a 1-based sequence. */
function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}

/** Next workspace-unique invoice number for the given year (count existing + 1). */
async function nextInvoiceNumber(
  db: ReturnType<typeof getDb>,
  workspaceId: WorkspaceId,
  year: number,
): Promise<string> {
  const prefix = `INV-${year}-`;
  const rows = await db
    .select({ n: count() })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), like(invoices.number, `${prefix}%`)));
  const seq = (rows[0]?.n ?? 0) + 1;
  return formatInvoiceNumber(year, seq);
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
 * 3× (best-effort — a dedicated `sequences` table would be more robust; see limitations).
 */
export async function createInvoice(
  workspaceId: WorkspaceId,
  input: InvoiceInput,
  actorId: UserId,
): Promise<InvoiceId> {
  if (input.lineItems.length === 0) throw new Error("An invoice needs at least one line item.");
  await assertCustomerInWorkspace(workspaceId, input.customerId ?? null);

  const totals = computeInvoiceTotals(input.lineItems, input.taxRate);
  const year = new Date().getFullYear();
  const db = getDb();

  let attempts = 0;
  let lastErr: unknown;
  while (attempts < 3) {
    attempts += 1;
    try {
      // Count existing invoices for this workspace+year OUTSIDE the transaction. The
      // unique index is the real guard against races: if two concurrent creates pick
      // the same seq, one insert throws a unique violation → the retry loop re-counts
      // (now seeing the committed row) and picks the next seq.
      const number = await nextInvoiceNumber(db, workspaceId, year);
      return await db.transaction(async (tx) => {
        const invRows = await tx
          .insert(invoices)
          .values({
            workspaceId,
            customerId: input.customerId ?? null,
            number,
            status: "draft",
            issueDate: input.issueDate,
            dueDate: input.dueDate ?? null,
            currency: input.currency ?? "AUD",
            taxRate: input.taxRate,
            subtotalCents: totals.subtotalCents,
            taxCents: totals.taxCents,
            totalCents: totals.totalCents,
            notes: input.notes ?? null,
          })
          .returning({ id: invoices.id });
        const inv = invRows[0];
        if (!inv) throw new Error("Failed to create invoice.");

        if (input.lineItems.length > 0) {
          await tx.insert(invoiceLineItems).values(
            input.lineItems.map((it, i) => ({
              invoiceId: inv.id,
              workspaceId,
              description: it.description,
              quantity: String(it.quantity),
              unitPriceCents: it.unitPriceCents,
              amountCents: lineItemAmountCents(it.quantity, it.unitPriceCents),
              position: i,
            })),
          );
        }

        await publishEvent({
          type: "InvoiceCreated",
          workspaceId,
          actorUserId: actorId,
          entityType: "invoice",
          entityId: inv.id,
          metadata: { number, totalCents: totals.totalCents },
        });
        await writeAudit({
          workspaceId,
          actorUserId: actorId,
          action: "invoice.create",
          targetType: "invoice",
          targetId: inv.id,
          metadata: {
            number,
            totalCents: totals.totalCents,
            lineItemCount: input.lineItems.length,
          },
        });
        return inv.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Failed to generate a unique invoice number.");
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

  const db = getDb();
  await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: invoices.id, status: invoices.status, taxRate: invoices.taxRate })
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
      .limit(1);
    const row = current[0];
    if (!row) throw new Error("Invoice not found.");
    if (row.status !== "draft") throw new Error("Only draft invoices can be edited.");

    const newLineItems = patch.lineItems;
    const newTaxRate = patch.taxRate;
    // Recompute totals when either line items or the tax rate change. When only the tax
    // rate changes (no new line items), recompute from the EXISTING line items so a
    // tax-rate-only edit still updates totals correctly.
    let totals: { subtotalCents: number; taxCents: number; totalCents: number } | null = null;
    if (newLineItems !== undefined) {
      totals = computeInvoiceTotals(newLineItems, newTaxRate ?? row.taxRate);
    } else if (newTaxRate !== undefined) {
      const existing = await tx
        .select({
          quantity: invoiceLineItems.quantity,
          unitPriceCents: invoiceLineItems.unitPriceCents,
        })
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, invoiceId));
      totals = computeInvoiceTotals(
        existing.map((e) => ({ quantity: Number(e.quantity), unitPriceCents: e.unitPriceCents })),
        newTaxRate,
      );
    }

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.customerId !== undefined) set.customerId = patch.customerId ?? null;
    if (patch.issueDate !== undefined) set.issueDate = patch.issueDate;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate ?? null;
    if (patch.currency !== undefined) set.currency = patch.currency;
    if (newTaxRate !== undefined) set.taxRate = newTaxRate;
    if (patch.notes !== undefined) set.notes = patch.notes ?? null;
    if (totals) {
      set.subtotalCents = totals.subtotalCents;
      set.taxCents = totals.taxCents;
      set.totalCents = totals.totalCents;
    }

    await tx.update(invoices).set(set).where(eq(invoices.id, invoiceId));

    if (newLineItems !== undefined) {
      await tx.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
      if (newLineItems.length > 0) {
        await tx.insert(invoiceLineItems).values(
          newLineItems.map((it, i) => ({
            invoiceId,
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

  // Draft edits are audit-only — not surfaced to the activity feed (too noisy). The feed
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
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 100, 200);
  const conditions: (SQL | undefined)[] = [eq(invoices.workspaceId, workspaceId)];
  if (opts?.status) conditions.push(eq(invoices.status, opts.status));
  if (opts?.customerId) conditions.push(eq(invoices.customerId, opts.customerId));
  const search = opts?.search?.trim();
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      or(ilike(invoices.number, term), ilike(customers.name, term), ilike(customers.company, term)),
    );
  }

  const rows = await db
    .select({
      ...selectInvoice,
      customerName: customers.name,
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(and(...conditions))
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(limit);

  return rows.map(({ customerName, ...inv }) => ({ ...inv, customerName: customerName ?? null }));
}

/**
 * Fetch a single invoice with its line items, scoped to the workspace. IDOR-safe —
 * returns null when the invoice belongs to another workspace.
 */
export async function getInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
): Promise<InvoiceWithItems | null> {
  const db = getDb();
  const invRows = await db
    .select({ ...selectInvoice, customerName: customers.name })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customerId, customers.id))
    .where(and(eq(invoices.id, invoiceId), eq(invoices.workspaceId, workspaceId)))
    .limit(1);
  const inv = invRows[0];
  if (!inv) return null;

  const itemRows = await db
    .select(selectLineItem)
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.position);

  const { customerName, ...rest } = inv;
  return {
    ...rest,
    customerName: customerName ?? null,
    lineItems: itemRows.map(mapLineItem),
  };
}

/**
 * Transition an invoice to a new status, guarded by `allowedFrom` states. The
 * `inArray(invoices.status, allowedFrom)` clause makes it atomic + idempotent: a
 * concurrent transition that already moved the invoice out of an allowed state makes
 * this update match zero rows (returns null → caller treats as no-op). Returns the
 * invoice number for audit, or null if nothing was transitioned.
 */
async function transition(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  to: InvoiceStatus,
  allowedFrom: InvoiceStatus[],
  set: Partial<{ sentAt: Date; paidAt: Date; publicToken: string }>,
): Promise<{ number: string } | null> {
  const db = getDb();
  const rows = await db
    .update(invoices)
    .set({ status: to, updatedAt: new Date(), ...set })
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.workspaceId, workspaceId),
        inArray(invoices.status, allowedFrom),
      ),
    )
    .returning({ id: invoices.id, number: invoices.number });
  return rows[0] ? { number: rows[0].number } : null;
}

/**
 * Send a draft invoice: `draft → sent`, sets `sentAt` + a random `publicToken` (for the
 * 5b public page). No email is sent in 5a. Returns false if the invoice wasn't a draft
 * (already sent / voided / not found) — idempotent.
 */
export async function sendInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  actorId: UserId,
): Promise<boolean> {
  const result = await transition(workspaceId, invoiceId, "sent", ["draft"], {
    sentAt: new Date(),
    publicToken: crypto.randomUUID(),
  });
  if (!result) return false;
  await publishEvent({
    type: "InvoiceSent",
    workspaceId,
    actorUserId: actorId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { number: result.number },
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
 * Mark a sent invoice paid (manual / offline payment — no Stripe in 5a): `sent → paid`,
 * sets `paidAt`. Returns false if it wasn't sent (or not found) — idempotent via the
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
  await publishEvent({
    type: "InvoicePaid",
    workspaceId,
    actorUserId: actorId,
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { number: result.number, source: "manual" },
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
 *  state or not found — idempotent via the atomic `transition`. */
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
 * Hard-delete a draft invoice (cascades line items). Only drafts — a sent/paid/voided
 * invoice is never deleted (the audit trail + history are preserved). Returns false if
 * not a draft or not found.
 */
export async function deleteInvoice(
  workspaceId: WorkspaceId,
  invoiceId: InvoiceId,
  actorId: UserId,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        eq(invoices.workspaceId, workspaceId),
        eq(invoices.status, "draft"),
      ),
    )
    .returning({ id: invoices.id, number: invoices.number });
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

// Re-export for callers that need the totals math directly (e.g. the create form's
// live preview). Keeps the barrel minimal.
export { computeInvoiceTotals, lineItemAmountCents } from "./totals";
