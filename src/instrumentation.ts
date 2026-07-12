import { onEvent, setEventPersister } from "@/server/events";
import { getDataClient } from "@/server/db/client";
import { unwrapVoid } from "@/server/db/helpers";
import type { Json } from "@/server/db/types";
import { ensureSubscription } from "@/platform/billing";
import { registerNotifications } from "@/platform/notifications";
import { registerBooksIntegration } from "@/modules/books/integration";
import { replayDriveEventsForBooks } from "@/modules/drive";

/**
 * Server bootstrap. Runs once on startup. Wires the event bus persister so
 * every published event is recorded in the activity feed, and subscribes
 * cross-module side effects that must NOT be direct imports (brief §9 - modules
 * communicate via the event bus).
 */
export async function register(): Promise<void> {
  setEventPersister(async (event) => {
    const supabase = getDataClient();
    await unwrapVoid(
      supabase.from("activity_events").insert({
        type: event.type,
        workspace_id: event.workspaceId,
        actor_user_id: event.actorUserId ?? null,
        entity_type: event.entityType,
        entity_id: event.entityId,
        // jsonb column: the event metadata is a plain object; cast through `unknown`
        // to `Json` (Record<string,unknown> isn't assignable to Json's object arm).
        metadata: (event.metadata ?? null) as unknown as Json,
      }),
    );
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
  // Fire-and-forget - `registerNotifications` just attaches handlers; no await needed.
  registerNotifications();

  // Phase 6c: subscribe the Books InvoicePaid → income recorder (cross-module, via the bus).
  // Fire-and-forget - `registerBooksIntegration` just attaches the handler; no await needed.
  registerBooksIntegration();

  // Wave 5: backfill Books when it's enabled for a workspace that already has Drive entries.
  // Earnings/expenses/trips logged while Books was disabled were never mirrored; re-publishing
  // their `*Logged` events lets the idempotent Books subscribers create the missing rows now.
  // Orchestrated here (composition layer) so the Books module never imports Drive directly.
  onEvent("ModuleEnabled", (event) => {
    if (!event.workspaceId) return;
    if (event.metadata?.moduleKey !== "books") return;
    replayDriveEventsForBooks(event.workspaceId, event.actorUserId).catch((err) => {
      console.error("[books] drive backfill failed for", event.workspaceId, err);
    });
  });
}
