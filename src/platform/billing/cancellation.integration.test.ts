import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDataClient } from "@/server/db/client";
import { unwrap, unwrapVoid } from "@/server/db/helpers";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus, onEvent } from "@/server/events";
import { getCreditBalance } from "./credits";

/**
 * Integration tests for the cancellation engine orchestrator (brief §10.6) against a
 * real Postgres. The Stripe lifecycle is mocked so `removeModuleSubscriptionItem` and
 * `refundToCard` don't hit Stripe - the orchestrator logic (scheduling, disabling,
 * ledger refund, events, finalize) is what's under test here.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Skipped when DATABASE_URL is unset.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

// Mock the Stripe lifecycle so no Stripe call is made.
const removeModuleSubscriptionItem = vi.fn();
const refundToCard = vi.fn();
vi.mock("@/server/stripe/stripe-lifecycle", () => ({
  removeModuleSubscriptionItem: (...args: unknown[]) => removeModuleSubscriptionItem(...args),
  refundToCard: (...args: unknown[]) => refundToCard(...args),
  BillingNotStartedError: class BillingNotStartedError extends Error {},
}));

import { removeModuleFromSubscription, finalizeModuleCancellations } from "./modules";
import { enableModule } from "@/platform/module-installations";
import { ensureSubscription } from "./subscriptions";

describe.skipIf(!HAS_DB)("cancellation engine integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000c1");
  let ws: WorkspaceId;
  const collectedEvents: { type: string; metadata?: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    clearEventBus();
    removeModuleSubscriptionItem.mockResolvedValue({ deletedItemId: "si_test" });
    refundToCard.mockResolvedValue("re_test");

    await seedUsers([
      { id: actor, email: "cancel-actor@soletrade-test.local", fullName: "Cancel Actor" },
    ]);
    ws = await createWorkspace(actor, "Cancel Test", `cancel-test-${Date.now()}`);

    // The WorkspaceCreated subscriber that provisions the subscription row is wiped
    // by clearEventBus() above, so create it explicitly, then seed active billing state.
    await ensureSubscription(ws);
    const anchor = new Date(Date.now() - 5 * 86_400_000);
    await unwrapVoid(
      getDataClient()
        .from("subscriptions")
        .update({
          billing_interval: "monthly",
          status: "active",
          stripe_subscription_id: "sub_test",
          stripe_customer_id: "cus_test",
          anchor_billing_date: anchor.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("workspace_id", ws),
    );

    // Install two modules: books (anchor) + invoices (addon).
    await enableModule(ws, "books", actor, "si_books");
    await enableModule(ws, "invoices", actor, "si_invoices");

    onEvent("ModuleCancelled", (e) => {
      collectedEvents.push({ type: e.type, metadata: e.metadata });
    });
    onEvent("ModuleDisabled", (e) => {
      collectedEvents.push({ type: e.type, metadata: e.metadata });
    });
    onEvent("RefundIssued", (e) => {
      collectedEvents.push({ type: e.type, metadata: e.metadata });
    });
  });

  afterAll(async () => {
    await cleanupWorkspaces(
      ws ? [ws] : [],
      [actor],
      [
        { table: "credit_ledger" },
        { table: "audit_logs" },
        { table: "module_installations" },
        { table: "subscriptions" },
      ],
    );
    clearEventBus();
  });

  async function getInstallation(key: string) {
    const rows = await unwrap(
      getDataClient()
        .from("module_installations")
        .select("status, cancelled_at, pending_cancellation_at")
        .eq("workspace_id", ws!)
        .eq("module_key", key as never),
    );
    return rows[0];
  }

  it("keep_until_end_of_cycle schedules pendingCancellationAt and leaves the module active", async () => {
    const res = await removeModuleFromSubscription(
      ws!,
      "invoices",
      actor,
      "keep_until_end_of_cycle",
    );
    expect(res.option).toBe("keep_until_end_of_cycle");
    expect(res.refundCents).toBe(0);
    expect(res.effectiveAt).not.toBeNull();
    // No Stripe item removal for the keep path.
    expect(removeModuleSubscriptionItem).not.toHaveBeenCalled();

    const row = await getInstallation("invoices");
    expect(row?.status).toBe("active");
    expect(row?.cancelled_at).toBeNull();
    expect(row?.pending_cancellation_at).not.toBeNull();
    // Effective at is the period end (≈ 25 days from the 5-day-ago anchor).
    expect(res.effectiveAt?.getTime()).toBeGreaterThan(Date.now());

    // No ledger refund row was written.
    const ledger = await unwrap(
      getDataClient().from("credit_ledger").select("entry_type").eq("workspace_id", ws!),
    );
    expect(ledger.length).toBe(0);

    // ModuleCancelled event fired with the keep option.
    const cancelled = collectedEvents.filter((e) => e.type === "ModuleCancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });

  it("finalizeModuleCancellations disables rows whose pendingCancellationAt has lapsed", async () => {
    // Force the scheduled timestamp into the past.
    await unwrapVoid(
      getDataClient()
        .from("module_installations")
        .update({ pending_cancellation_at: new Date(Date.now() - 86_400_000).toISOString() })
        .eq("workspace_id", ws!)
        .eq("module_key", "invoices" as never),
    );

    const count = await finalizeModuleCancellations(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await getInstallation("invoices");
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelled_at).not.toBeNull();
    // The finalize step calls the (mocked) Stripe item removal.
    expect(removeModuleSubscriptionItem).toHaveBeenCalled();
  });

  it("immediate_credit disables the module and writes a ledger refund", async () => {
    removeModuleSubscriptionItem.mockClear();
    const before = await getCreditBalance(ws!);
    const res = await removeModuleFromSubscription(ws!, "books", actor, "immediate_credit");
    expect(res.option).toBe("immediate_credit");
    expect(res.refundCents).toBeGreaterThan(0);

    const row = await getInstallation("books");
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelled_at).not.toBeNull();

    // Ledger balance increased by the refund (append-only ledger).
    const after = await getCreditBalance(ws!);
    expect(after).toBe(before + res.refundCents);

    // A refund ledger row exists.
    const ledger = await unwrap(
      getDataClient().from("credit_ledger").select("entry_type, reason").eq("workspace_id", ws!),
    );
    expect(ledger.some((r) => r.entry_type === "refund")).toBe(true);
  });

  it("immediate_refund disables the module and issues a card refund (no ledger entry)", async () => {
    // Re-enable a module so there's something to cancel.
    await enableModule(ws, "drive", actor, "si_drive");
    refundToCard.mockResolvedValueOnce("re_test_id");

    const before = await getCreditBalance(ws!);
    const res = await removeModuleFromSubscription(ws!, "drive", actor, "immediate_refund");
    expect(res.option).toBe("immediate_refund");
    expect(res.stripeRefundId).toBe("re_test_id");
    expect(res.refundCents).toBeGreaterThan(0);

    const row = await getInstallation("drive");
    expect(row?.status).toBe("cancelled");

    // No ledger balance change for a card refund.
    const after = await getCreditBalance(ws!);
    expect(after).toBe(before);

    // RefundIssued event fired with method: "card".
    const cardRefund = collectedEvents.find(
      (e) => e.type === "RefundIssued" && (e.metadata as { method?: string })?.method === "card",
    );
    expect(cardRefund).toBeDefined();
  });
});
