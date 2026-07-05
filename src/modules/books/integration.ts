import "server-only";
import { and, eq } from "drizzle-orm";
import { onEvent, type BusEvent } from "@/server/events";
import { getDb } from "@/server/db";
import { bookTransactions } from "@/server/db/schema";
import { isModuleEnabled } from "@/platform/module-installations";
import { getCustomer } from "@/platform/customers";
import { createTransaction } from "./index";
import {
  branded,
  type CustomerId,
  type InvoiceId,
  type UserId,
  type WorkspaceId,
} from "@/shared/types/ids";

/**
 * Books cross-module integration (Phase 6c). Subscribes to `InvoicePaid` on the event bus and
 * auto-records a Books income transaction for the paid amount — the first cross-module side
 * effect (brief §9: modules communicate via the event bus, never direct imports). This module
 * imports `@/modules/books` (its own module), `@/platform/*`, `@/server/*`, and `@/shared/*`
 * only. It does **NOT** import `@/modules/invoices` — the entire contract (invoice number,
 * total, currency, customer, invoice id) arrives via `event.metadata` + `event.entityId`.
 *
 * Wired once at startup from `src/instrumentation.ts` (fire-and-forget, like
 * `registerNotifications`). Best-effort: the event bus isolates a failing handler from the
 * publisher, and `createTransaction` is wrapped so a thrown error logs + swallows (a failed
 * auto-record must not break the invoice payment flow).
 *
 * Idempotency: the source `InvoicePaid` is itself idempotent (atomic transition publishes only
 * on the first paid mark), but this subscriber adds a second line of defense — a
 * check-then-insert on `book_transactions.source_invoice_id` — so a future queue-backed bus
 * redelivering the event cannot double-count income.
 *
 * Module gate: if Books isn't installed for the workspace, the event is a no-op (no orphan
 * rows in a module that isn't there). Income paid while Books is disabled is NOT backfilled
 * when Books is later enabled (documented limitation).
 */

/** Defensive parse of the `InvoicePaid` event metadata (the Books-side contract). */
function readInvoicePaidMeta(event: BusEvent): {
  invoiceId: InvoiceId;
  number: string;
  totalCents: number;
  currency: string;
  customerId: CustomerId | null;
} | null {
  const m = event.metadata;
  const entityId = typeof event.entityId === "string" ? event.entityId : null;
  if (!m || !entityId) return null;
  const number = typeof m.number === "string" ? m.number : null;
  const totalCents = typeof m.totalCents === "number" && m.totalCents > 0 ? m.totalCents : null;
  const currency = typeof m.currency === "string" && m.currency.length === 3 ? m.currency : null;
  if (!number || totalCents === null || !currency) return null;
  const customerId = typeof m.customerId === "string" ? branded<"CustomerId">(m.customerId) : null;
  return {
    invoiceId: branded<"InvoiceId">(entityId),
    number,
    totalCents,
    currency,
    customerId,
  };
}

async function onInvoicePaid(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;

  // Module gate — no-op if Books isn't installed.
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readInvoicePaidMeta(event);
  if (!meta) {
    console.error("[books] InvoicePaid event missing required metadata:", event.entityId);
    return;
  }

  // Idempotency: skip if an income row already exists for this invoice.
  const db = getDb();
  const existing = await db
    .select({ id: bookTransactions.id })
    .from(bookTransactions)
    .where(
      and(
        eq(bookTransactions.workspaceId, workspaceId),
        eq(bookTransactions.sourceInvoiceId, meta.invoiceId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  // Resolve the customer defensively — a customer deleted between send and payment must not
  // block recording income; fall back to an unlinked row.
  let customerId: CustomerId | null = null;
  if (meta.customerId) {
    const c = await getCustomer(workspaceId, meta.customerId);
    customerId = c ? meta.customerId : null;
  }

  try {
    await createTransaction(
      workspaceId,
      {
        type: "income",
        amountCents: meta.totalCents,
        currency: meta.currency,
        date: new Date(),
        description: `Invoice ${meta.number}`,
        category: "invoice",
        customerId,
        notes: `Auto-recorded from invoice ${meta.number}.`,
        sourceInvoiceId: meta.invoiceId,
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] auto-record from invoice failed:", meta.invoiceId, err);
  }
}

/**
 * Subscribe the Books `InvoicePaid` handler. Returns an unsubscribe (for tests); in production
 * this is fire-and-forget — wired once at startup in `src/instrumentation.ts`.
 */
export function registerBooksIntegration(): () => void {
  return onEvent("InvoicePaid", onInvoicePaid);
}
