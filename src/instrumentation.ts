import { onEvent, setEventPersister } from "@/server/events";
import { getDb } from "@/server/db";
import { activityEvents } from "@/server/db/schema";
import { ensureSubscription } from "@/platform/billing";
import { registerNotifications } from "@/platform/notifications";
import { registerBooksIntegration } from "@/modules/books/integration";

/**
 * Server bootstrap. Runs once on startup. Wires the event bus persister so
 * every published event is recorded in the activity feed, and subscribes
 * cross-module side effects that must NOT be direct imports (brief §9 — modules
 * communicate via the event bus).
 */
export async function register(): Promise<void> {
  setEventPersister(async (event) => {
    const db = getDb();
    await db.insert(activityEvents).values({
      type: event.type,
      workspaceId: event.workspaceId,
      actorUserId: event.actorUserId,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: event.metadata,
    });
  });

  // Provision a free-tier subscription for every new workspace. `createWorkspace`
  // stays free of billing imports (platform/billing must not be coupled to the
  // workspaces service); this subscriber is the seam. `ensureSubscription` is
  // idempotent, so a failed/late handler self-heals (the /billing loader calls
  // it lazily too).
  onEvent("WorkspaceCreated", async (event) => {
    if (!event.workspaceId) return;
    await ensureSubscription(event.workspaceId).catch((err) => {
      console.error("[billing] ensureSubscription failed for", event.workspaceId, err);
    });
  });

  // Phase 5c: subscribe invoice email handlers (InvoiceSent/Overdue/Paid → Resend).
  // Fire-and-forget — `registerNotifications` just attaches handlers; no await needed.
  registerNotifications();

  // Phase 6c: subscribe the Books InvoicePaid → income recorder (cross-module, via the bus).
  // Fire-and-forget — `registerBooksIntegration` just attaches the handler; no await needed.
  registerBooksIntegration();
}
