import "server-only";
import { and, eq } from "drizzle-orm";
import { onEvent, type BusEvent } from "@/server/events";
import { getDb } from "@/server/db";
import { bookTransactions } from "@/server/db/schema";
import { isModuleEnabled } from "@/platform/module-installations";
import { getCustomer } from "@/platform/customers";
import { platformLabel } from "@/shared/constants/drive-platforms";
import { createTransaction } from "./index";
import {
  branded,
  type CustomerId,
  type DriveEarningId,
  type InvoiceId,
  type UserId,
  type WorkspaceId,
} from "@/shared/types/ids";

/**
 * Books cross-module integration. Subscribes to cross-module events on the bus and
 * auto-records a Books income transaction for each — modules communicate via the event bus,
 * never direct imports (brief §9). This module imports `@/modules/books` (its own module),
 * `@/platform/*`, `@/server/*`, and `@/shared/*` only. It does **NOT** import `@/modules/invoices`
 * or `@/modules/drive` — the entire contract arrives via `event.metadata` + `event.entityId`.
 *
 * Two subscribers (the second added in Phase 7):
 *
 * 1. **`InvoicePaid` → Books income** (Phase 6c). Records an income row (category `invoice`)
 *    for the paid amount, linked to the invoice's customer + `sourceInvoiceId`. Idempotent via
 *    check-then-insert on `source_invoice_id`.
 * 2. **`DriveEarningsLogged` → Books income** (Phase 7). Records an income row (category `gig`)
 *    for the earned amount, linked via `sourceEarningId` (no customer — gig earnings have no
 *    customer). Idempotent via check-then-insert on `source_earning_id`.
 *
 * Wired once at startup from `src/instrumentation.ts` (fire-and-forget, like
 * `registerNotifications`). Best-effort: the event bus isolates a failing handler from the
 * publisher, and each `createTransaction` is wrapped so a thrown error logs + swallows (a
 * failed auto-record must not break the source flow — invoice payment or Drive create).
 *
 * Module gate: if Books isn't installed for the workspace, the event is a no-op (no orphan
 * rows in a module that isn't there). Income earned while Books is disabled is NOT backfilled
 * when Books is later enabled (documented limitation, applies to both subscribers).
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

/** Defensive parse of the `DriveEarningsLogged` event metadata (the Books-side contract). */
function readDriveEarningsMeta(event: BusEvent): {
  earningId: DriveEarningId;
  amountCents: number;
  currency: string;
  platform: string;
  date: Date;
  description: string;
} | null {
  const m = event.metadata;
  const entityId = typeof event.entityId === "string" ? event.entityId : null;
  if (!m || !entityId) return null;
  const amountCents = typeof m.amountCents === "number" && m.amountCents > 0 ? m.amountCents : null;
  const currency = typeof m.currency === "string" && m.currency.length === 3 ? m.currency : null;
  const platform = typeof m.platform === "string" ? m.platform : null;
  const date = m.date instanceof Date ? m.date : null;
  const description = typeof m.description === "string" ? m.description : "";
  if (amountCents === null || !currency || !platform || !date) return null;
  return {
    earningId: branded<"DriveEarningId">(entityId),
    amountCents,
    currency,
    platform,
    date,
    description,
  };
}

async function onDriveEarningsLogged(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;

  // Module gate — no-op if Books isn't installed.
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readDriveEarningsMeta(event);
  if (!meta) {
    console.error("[books] DriveEarningsLogged event missing required metadata:", event.entityId);
    return;
  }

  // Idempotency: skip if an income row already exists for this earning.
  const db = getDb();
  const existing = await db
    .select({ id: bookTransactions.id })
    .from(bookTransactions)
    .where(
      and(
        eq(bookTransactions.workspaceId, workspaceId),
        eq(bookTransactions.sourceEarningId, meta.earningId),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  // Gig earnings have no customer — record unlinked income. Use the earning's user-chosen date
  // (from metadata) so the income lands in the right P&L period (a back-dated earning records
  // in its own month, unlike the InvoicePaid subscriber which uses event-processing time).
  const label = platformLabel(meta.platform) ?? meta.platform;
  try {
    await createTransaction(
      workspaceId,
      {
        type: "income",
        amountCents: meta.amountCents,
        currency: meta.currency,
        date: meta.date,
        description: `Drive earnings · ${label}`,
        category: "gig",
        customerId: null,
        notes: `Auto-recorded from drive earnings (${label}).`,
        sourceEarningId: meta.earningId,
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] auto-record from drive earning failed:", meta.earningId, err);
  }
}

/**
 * Subscribe the Books cross-module handlers. Returns a composed unsubscribe (for tests); in
 * production this is fire-and-forget — wired once at startup in `src/instrumentation.ts`.
 */
export function registerBooksIntegration(): () => void {
  const u1 = onEvent("InvoicePaid", onInvoicePaid);
  const u2 = onEvent("DriveEarningsLogged", onDriveEarningsLogged);
  return () => {
    u1();
    u2();
  };
}
