import "server-only";
import { scheduleAfterResponse } from "@/server/infrastructure/after-response";
import type { UserId, WorkspaceId } from "@/types/ids";

/**
 * In-process typed event bus (brief §9). Designed to swap for a queue-backed
 * system later: the public surface is `publishEvent` / `onEvent`; persistence
 * to the activity feed is a pluggable persister set at app bootstrap
 * (`setEventPersister`), so the dispatch logic stays unit-testable without a DB.
 *
 * Subscribers run in one of two ways. By default a handler is awaited before
 * `publishEvent` returns. A subscriber registered with `{ deferred: true }` instead runs
 * after the HTTP response has been sent (Next.js `after`), so slow, best-effort side
 * effects such as rendering a PDF and calling the email provider no longer hold up the
 * user's "Send invoice" click, a customer's quote acceptance or the Stripe webhook's 200.
 * Deferral is only possible while a request is being handled; anywhere else (tests,
 * scripts, startup) deferred handlers are awaited like the rest.
 */

/** Canonical event types (brief §8.3). Modules may publish additional string types. */
export const EVENT_TYPES = [
  "WorkspaceCreated",
  "WorkspaceUpdated",
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
  "QuoteExpired",
  "InvoiceCreated",
  "InvoiceSent",
  "InvoiceViewed",
  "InvoicePaid",
  "InvoiceOverdue",
  "InvoiceVoided",
  "TransactionCreated",
  "TransactionUpdated",
  "TransactionDeleted",
  "ReceiptUploaded",
  "ReceiptProcessed",
  "MileageLogged",
  "MileageUpdated",
  "MileageDeleted",
  "DriveEarningsLogged",
  "DriveEarningUpdated",
  "DriveEarningDeleted",
  "VehicleExpenseLogged",
  "VehicleExpenseUpdated",
  "VehicleExpenseDeleted",
  "SubscriptionChanged",
  "CreditIssued",
  "RefundIssued",
  "CreditExpired",
  "MemberInvited",
  "MemberAdded",
  "MemberRoleChanged",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface BusEvent {
  /** Event type string - one of EVENT_TYPES or a module-defined type. */
  type: string;
  workspaceId: WorkspaceId;
  actorUserId?: UserId;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

type Handler = (event: BusEvent) => void | Promise<void>;
type Persister = (event: BusEvent) => void | Promise<void>;
type Subscription = { handler: Handler; deferred: boolean };

/**
 * Queues work to run once the current response has been sent. Returns false when that is
 * not possible, in which case the caller runs the work itself.
 */
export type EventScheduler = (task: () => Promise<void>) => boolean;

/**
 * The bus's registry lives on `globalThis`, not in module variables.
 *
 * The server bundles `instrumentation.ts` (which registers the activity persister and the
 * notification subscribers at start-up) separately from the routes and Server Actions that
 * publish events, and each bundle gets its own copy of this module. With module-level
 * state the subscribers were registered on one copy while every `publishEvent` ran on
 * another that had none, so events were silently dropped: no activity entries, no in-app
 * notifications, no emails. One registry per process, shared by every copy, fixes that.
 * `Symbol.for` returns the same key in every copy.
 */
interface BusState {
  handlers: Map<string, Set<Subscription>>;
  persister: Persister | null;
  /** Test override for how deferred handlers are scheduled; null means the default. */
  scheduler: EventScheduler | null;
}

const BUS_STATE_KEY = Symbol.for("soletrade.event-bus.state");

function bus(): BusState {
  const scope = globalThis as typeof globalThis & { [BUS_STATE_KEY]?: BusState };
  return (scope[BUS_STATE_KEY] ??= { handlers: new Map(), persister: null, scheduler: null });
}

export interface SubscribeOptions {
  /**
   * Run this handler after the response has been sent instead of before `publishEvent`
   * returns. Only for best-effort side effects that nothing later in the request reads
   * (email, PDF, in-app notifications). It must not use request-only APIs such as
   * `cookies()` or `headers()`: those are unavailable once a page render has finished.
   */
  deferred?: boolean;
}

/** Subscribe to events of a given type. Returns an unsubscribe function. */
export function onEvent(
  type: string,
  handler: Handler,
  options: SubscribeOptions = {},
): () => void {
  const { handlers } = bus();
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  const subscription: Subscription = { handler, deferred: options.deferred === true };
  set.add(subscription);
  return () => {
    set?.delete(subscription);
  };
}

/** Set the activity-feed persister (wired in `src/instrumentation.ts`). */
export function setEventPersister(p: Persister | null): void {
  bus().persister = p;
}

/** Test-only: replace how deferred handlers are scheduled (`null` restores the default). */
export function setEventScheduler(next: EventScheduler | null): void {
  bus().scheduler = next;
}

/** Test-only: reset bus state between tests. */
export function clearEventBus(): void {
  const state = bus();
  state.handlers.clear();
  state.persister = null;
  state.scheduler = null;
}

/** Run handlers in parallel; a failing handler is logged and does not stop the others. */
async function runHandlers(subscriptions: Subscription[], event: BusEvent): Promise<void> {
  await Promise.all(
    subscriptions.map(async ({ handler }) => {
      try {
        await handler(event);
      } catch (err) {
        console.error("[event-bus] handler failed:", err);
      }
    }),
  );
}

/**
 * Publish an event. Persists to the activity feed (best effort, always awaited so the
 * feed is current when the caller returns), then notifies subscribers in parallel (best
 * effort - a failing handler doesn't stop others). Subscribers registered as deferred are
 * handed to the scheduler to run after the response; if it declines they run here.
 */
export async function publishEvent(event: BusEvent): Promise<void> {
  const { handlers, persister, scheduler } = bus();
  if (persister) {
    try {
      await persister(event);
    } catch (err) {
      console.error("[event-bus] persister failed:", err);
    }
  }
  const set = handlers.get(event.type);
  if (!set || set.size === 0) return;
  const subscriptions = [...set];
  const deferred = subscriptions.filter((subscription) => subscription.deferred);
  const schedule = scheduler ?? scheduleAfterResponse;
  const scheduled = deferred.length > 0 && schedule(() => runHandlers(deferred, event));
  await runHandlers(
    scheduled ? subscriptions.filter((subscription) => !subscription.deferred) : subscriptions,
    event,
  );
}
