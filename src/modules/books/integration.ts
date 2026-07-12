import "server-only";
import { onEvent, type BusEvent } from "@/server/events";
import { isModuleEnabled } from "@/platform/module-installations";
import { getCustomer } from "@/platform/customers";
import { platformLabel } from "@/shared/constants/drive-platforms";
import {
  createTransaction,
  deleteTransaction,
  findTransactionIdBySource,
  updateTransaction,
} from "./index";
import {
  branded,
  type CustomerId,
  type DriveEarningId,
  type DriveExpenseId,
  type DriveTripId,
  type InvoiceId,
  type UserId,
  type WorkspaceId,
} from "@/shared/types/ids";

/**
 * Books cross-module integration. Subscribes to cross-module events on the bus and
 * auto-records a Books transaction for each - modules communicate via the event bus, never
 * direct imports (brief §9). This module imports `@/modules/books` (its own module),
 * `@/platform/*`, `@/server/*`, and `@/shared/*` only. It does **NOT** import `@/modules/invoices`
 * or `@/modules/drive` - the entire contract arrives via `event.metadata` + `event.entityId`.
 *
 * Subscribers:
 *
 * 1. **`InvoicePaid` → Books income** (Phase 6c). Records an income row (category `invoice`)
 *    for the paid amount, linked to the invoice's customer + `sourceInvoiceId`. Idempotent via
 *    check-then-insert on `source_invoice_id`.
 * 2. **`DriveEarningsLogged` → Books income** (Phase 7). Records an income row (category `gig`)
 *    for the earned amount, linked via `sourceEarningId`. **`DriveEarningUpdated`** /
 *    **`DriveEarningDeleted`** (Wave 5) reconcile the mirrored row - "Drive wins", the Books
 *    row is overwritten on edit and removed on delete.
 * 3. **`VehicleExpenseLogged` → Books expense** (Wave 2). Records an expense row (category
 *    `vehicle_expense`) for the logged amount, linked via `sourceExpenseId`.
 *    **`VehicleExpenseUpdated`** / **`VehicleExpenseDeleted`** (Wave 5) reconcile the mirror.
 * 4. **`MileageLogged` → Books expense** (Wave 5). Records an expense row (category `mileage`)
 *    for the computed deduction (distance × workspace mileage rate), linked via `sourceTripId`.
 *    **`MileageUpdated`** / **`MileageDeleted`** reconcile the mirror.
 *
 * Wired once at startup from `src/instrumentation.ts` (fire-and-forget, like
 * `registerNotifications`). Best-effort: the event bus isolates a failing handler from the
 * publisher, and each create/update/delete is wrapped so a thrown error logs + swallows (a
 * failed auto-record must not break the source flow - invoice payment or Drive mutation).
 *
 * Module gate: if Books isn't installed for the workspace, every event is a no-op (no orphan
 * rows in a module that isn't there). Entries logged while Books is disabled are backfilled
 * when Books is later enabled - `replayDriveEventsForBooks` (in `@/modules/drive`) re-publishes
 * the `*Logged` events for existing Drive rows, wired from `src/instrumentation.ts` on
 * `ModuleEnabled`.
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

  // Module gate - no-op if Books isn't installed.
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readInvoicePaidMeta(event);
  if (!meta) {
    console.error("[books] InvoicePaid event missing required metadata:", event.entityId);
    return;
  }

  // Idempotency: skip if an income row already exists for this invoice.
  if (await findTransactionIdBySource(workspaceId, { sourceInvoiceId: meta.invoiceId })) return;

  // Resolve the customer defensively - a customer deleted between send and payment must not
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

  // Module gate - no-op if Books isn't installed.
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readDriveEarningsMeta(event);
  if (!meta) {
    console.error("[books] DriveEarningsLogged event missing required metadata:", event.entityId);
    return;
  }

  // Idempotency: skip if an income row already exists for this earning.
  if (await findTransactionIdBySource(workspaceId, { sourceEarningId: meta.earningId })) return;

  // Gig earnings have no customer - record unlinked income. Use the earning's user-chosen date
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
 * Defensive parse of the `VehicleExpenseLogged` event metadata (the Books-side contract).
 * Emitted by `createExpense` in `@/modules/drive`.
 */
function readVehicleExpenseMeta(event: BusEvent): {
  expenseId: DriveExpenseId;
  amountCents: number;
  currency: string;
  date: Date;
  description: string;
} | null {
  const m = event.metadata;
  const entityId = typeof event.entityId === "string" ? event.entityId : null;
  if (!m || !entityId) return null;
  const amountCents = typeof m.amountCents === "number" && m.amountCents > 0 ? m.amountCents : null;
  const currency = typeof m.currency === "string" && m.currency.length === 3 ? m.currency : null;
  const date = m.date instanceof Date ? m.date : null;
  const description = typeof m.description === "string" ? m.description : "";
  if (amountCents === null || !currency || !date) return null;
  return {
    expenseId: branded<"DriveExpenseId">(entityId),
    amountCents,
    currency,
    date,
    description,
  };
}

async function onVehicleExpenseLogged(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;

  // Module gate - no-op if Books isn't installed.
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readVehicleExpenseMeta(event);
  if (!meta) {
    console.error("[books] VehicleExpenseLogged event missing required metadata:", event.entityId);
    return;
  }

  // Idempotency: skip if an expense row already exists for this drive expense.
  if (await findTransactionIdBySource(workspaceId, { sourceExpenseId: meta.expenseId })) return;

  // Vehicle expenses have no customer - record unlinked expense. Use the expense's user-chosen
  // date so it lands in the right P&L period (mirrors the DriveEarningsLogged subscriber).
  try {
    await createTransaction(
      workspaceId,
      {
        type: "expense",
        amountCents: meta.amountCents,
        currency: meta.currency,
        date: meta.date,
        description: meta.description || "Vehicle expense",
        category: "vehicle_expense",
        customerId: null,
        notes: "Auto-recorded from drive vehicle expense.",
        sourceExpenseId: meta.expenseId,
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] auto-record from drive expense failed:", meta.expenseId, err);
  }
}

/**
 * Extract a source id from an event: prefer the explicit id in `metadata[key]`, fall back to
 * `entityId` (both are set by the Drive publishers). Returns null when neither is a string.
 */
function readSourceId(event: BusEvent, key: string): string | null {
  const m = event.metadata;
  const fromMeta = m && typeof m[key] === "string" ? (m[key] as string) : null;
  const fromEntity = typeof event.entityId === "string" ? event.entityId : null;
  return fromMeta ?? fromEntity;
}

// ───────────────── Drive earnings: update / delete sync ("Drive wins") ─────────────────

async function onDriveEarningUpdated(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readDriveEarningsMeta(event);
  if (!meta) return; // best-effort - a malformed update is swallowed

  const txId = await findTransactionIdBySource(workspaceId, { sourceEarningId: meta.earningId });
  if (!txId) return; // nothing to sync (e.g. Books was disabled at create time - backfill covers it)
  try {
    // "Drive wins" - overwrite amount/currency/date/description. Keep category + source link.
    await updateTransaction(
      workspaceId,
      txId,
      {
        amountCents: meta.amountCents,
        currency: meta.currency,
        date: meta.date,
        description: `Drive earnings · ${platformLabel(meta.platform) ?? meta.platform}`,
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] sync from drive earning update failed:", meta.earningId, err);
  }
}

async function onDriveEarningDeleted(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const id = readSourceId(event, "earningId");
  if (!id) return;
  const txId = await findTransactionIdBySource(workspaceId, {
    sourceEarningId: branded<"DriveEarningId">(id),
  });
  if (!txId) return;
  try {
    await deleteTransaction(workspaceId, txId, event.actorUserId as UserId | undefined);
  } catch (err) {
    console.error("[books] sync from drive earning delete failed:", id, err);
  }
}

// ─────────────── Vehicle expenses: update / delete sync ("Drive wins") ────────────────

async function onVehicleExpenseUpdated(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readVehicleExpenseMeta(event);
  if (!meta) return;

  const txId = await findTransactionIdBySource(workspaceId, { sourceExpenseId: meta.expenseId });
  if (!txId) return;
  try {
    await updateTransaction(
      workspaceId,
      txId,
      {
        amountCents: meta.amountCents,
        currency: meta.currency,
        date: meta.date,
        description: meta.description || "Vehicle expense",
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] sync from drive expense update failed:", meta.expenseId, err);
  }
}

async function onVehicleExpenseDeleted(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const id = readSourceId(event, "expenseId");
  if (!id) return;
  const txId = await findTransactionIdBySource(workspaceId, {
    sourceExpenseId: branded<"DriveExpenseId">(id),
  });
  if (!txId) return;
  try {
    await deleteTransaction(workspaceId, txId, event.actorUserId as UserId | undefined);
  } catch (err) {
    console.error("[books] sync from drive expense delete failed:", id, err);
  }
}

// ─────────────────────── Mileage: create / update / delete ───────────────────────

/** Defensive parse of the `MileageLogged` / `MileageUpdated` event metadata. */
function readMileageMeta(event: BusEvent): {
  tripId: DriveTripId;
  platform: string;
  distanceMeters: number;
  date: Date;
  amountCents: number;
  currency: string;
} | null {
  const m = event.metadata;
  const id = readSourceId(event, "tripId");
  if (!m || !id) return null;
  const platform = typeof m.platform === "string" ? m.platform : null;
  const distanceMeters =
    typeof m.distanceMeters === "number" && m.distanceMeters > 0 ? m.distanceMeters : null;
  const date = m.date instanceof Date ? m.date : null;
  const amountCents = typeof m.amountCents === "number" && m.amountCents > 0 ? m.amountCents : null;
  const currency = typeof m.currency === "string" && m.currency.length === 3 ? m.currency : null;
  if (!platform || distanceMeters === null || !date || amountCents === null || !currency)
    return null;
  return {
    tripId: branded<"DriveTripId">(id),
    platform,
    distanceMeters,
    date,
    amountCents,
    currency,
  };
}

async function onMileageLogged(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readMileageMeta(event);
  if (!meta) {
    console.error("[books] MileageLogged event missing required metadata:", event.entityId);
    return;
  }

  // Idempotency: skip if a mileage row already exists for this trip.
  if (await findTransactionIdBySource(workspaceId, { sourceTripId: meta.tripId })) return;

  const label = platformLabel(meta.platform) ?? meta.platform;
  try {
    await createTransaction(
      workspaceId,
      {
        type: "expense",
        amountCents: meta.amountCents,
        currency: meta.currency,
        date: meta.date,
        description: `Drive mileage · ${label}`,
        category: "mileage",
        customerId: null,
        notes: `Auto-recorded from drive mileage (${label}).`,
        sourceTripId: meta.tripId,
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] auto-record from drive mileage failed:", meta.tripId, err);
  }
}

async function onMileageUpdated(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const meta = readMileageMeta(event);
  if (!meta) return;

  const txId = await findTransactionIdBySource(workspaceId, { sourceTripId: meta.tripId });
  if (!txId) return;
  try {
    await updateTransaction(
      workspaceId,
      txId,
      {
        amountCents: meta.amountCents,
        currency: meta.currency,
        date: meta.date,
        description: `Drive mileage · ${platformLabel(meta.platform) ?? meta.platform}`,
      },
      event.actorUserId as UserId | undefined,
    );
  } catch (err) {
    console.error("[books] sync from drive mileage update failed:", meta.tripId, err);
  }
}

async function onMileageDeleted(event: BusEvent): Promise<void> {
  if (!event.workspaceId) return;
  const workspaceId = event.workspaceId as WorkspaceId;
  if (!(await isModuleEnabled(workspaceId, "books"))) return;

  const id = readSourceId(event, "tripId");
  if (!id) return;
  const txId = await findTransactionIdBySource(workspaceId, {
    sourceTripId: branded<"DriveTripId">(id),
  });
  if (!txId) return;
  try {
    await deleteTransaction(workspaceId, txId, event.actorUserId as UserId | undefined);
  } catch (err) {
    console.error("[books] sync from drive mileage delete failed:", id, err);
  }
}

/**
 * Subscribe the Books cross-module handlers. Returns a composed unsubscribe (for tests); in
 * production this is fire-and-forget - wired once at startup in `src/instrumentation.ts`.
 */
export function registerBooksIntegration(): () => void {
  const u1 = onEvent("InvoicePaid", onInvoicePaid);
  const u2 = onEvent("DriveEarningsLogged", onDriveEarningsLogged);
  const u3 = onEvent("VehicleExpenseLogged", onVehicleExpenseLogged);
  const u4 = onEvent("DriveEarningUpdated", onDriveEarningUpdated);
  const u5 = onEvent("DriveEarningDeleted", onDriveEarningDeleted);
  const u6 = onEvent("VehicleExpenseUpdated", onVehicleExpenseUpdated);
  const u7 = onEvent("VehicleExpenseDeleted", onVehicleExpenseDeleted);
  const u8 = onEvent("MileageLogged", onMileageLogged);
  const u9 = onEvent("MileageUpdated", onMileageUpdated);
  const u10 = onEvent("MileageDeleted", onMileageDeleted);
  return () => {
    u1();
    u2();
    u3();
    u4();
    u5();
    u6();
    u7();
    u8();
    u9();
    u10();
  };
}
