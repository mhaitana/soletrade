import "server-only";
import type { UserId, WorkspaceId } from "@/shared/types/ids";

/**
 * In-process typed event bus (brief §9). Designed to swap for a queue-backed
 * system later: the public surface is `publishEvent` / `onEvent`; persistence
 * to the activity feed is a pluggable persister set at app bootstrap
 * (`setEventPersister`), so the dispatch logic stays unit-testable without a DB.
 */

/** Canonical event types (brief §8.3). Modules may publish additional string types. */
export const EVENT_TYPES = [
  "WorkspaceCreated",
  "ModuleEnabled",
  "ModuleDisabled",
  "ModuleCancelled",
  "CustomerCreated",
  "CustomerUpdated",
  "CustomerDeleted",
  "QuoteSent",
  "QuoteViewed",
  "QuoteAccepted",
  "QuoteDeclined",
  "QuoteConvertedToInvoice",
  "InvoiceSent",
  "InvoiceViewed",
  "InvoicePaid",
  "InvoiceOverdue",
  "ReceiptUploaded",
  "ReceiptProcessed",
  "MileageLogged",
  "DriveEarningsLogged",
  "SubscriptionChanged",
  "CreditIssued",
  "RefundIssued",
  "MemberInvited",
  "MemberAdded",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface BusEvent {
  /** Event type string — one of EVENT_TYPES or a module-defined type. */
  type: string;
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

type Handler = (event: BusEvent) => void | Promise<void>;
type Persister = (event: BusEvent) => void | Promise<void>;

const handlers = new Map<string, Set<Handler>>();
let persister: Persister | null = null;

/** Subscribe to events of a given type. Returns an unsubscribe function. */
export function onEvent(type: string, handler: Handler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

/** Set the activity-feed persister (wired in `src/instrumentation.ts`). */
export function setEventPersister(p: Persister | null): void {
  persister = p;
}

/** Test-only: reset bus state between tests. */
export function clearEventBus(): void {
  handlers.clear();
  persister = null;
}

/**
 * Publish an event. Persists to the activity feed (best effort) then notifies
 * subscribers in parallel (best effort — a failing handler doesn't stop others).
 */
export async function publishEvent(event: BusEvent): Promise<void> {
  if (persister) {
    try {
      await persister(event);
    } catch (err) {
      console.error("[event-bus] persister failed:", err);
    }
  }
  const set = handlers.get(event.type);
  if (!set || set.size === 0) return;
  await Promise.all(
    [...set].map(async (handler) => {
      try {
        await handler(event);
      } catch (err) {
        console.error("[event-bus] handler failed:", err);
      }
    }),
  );
}
