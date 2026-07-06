import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  creditLedger as creditLedgerTable,
  moduleInstallations as moduleInstallationsTable,
  subscriptions as subscriptionsTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus, onEvent } from "@/server/events";
import { getCreditBalance } from "./credits";

/**
 * Integration tests for the cancellation engine orchestrator (brief §10.6) against a
 * real Postgres. The Stripe lifecycle is mocked so `removeModuleSubscriptionItem` and
 * `refundToCard` don't hit Stripe — the orchestrator logic (scheduling, disabling,
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
    const db = getDb();
    clearEventBus();
    removeModuleSubscriptionItem.mockResolvedValue({ deletedItemId: "si_test" });
    refundToCard.mockResolvedValue("re_test");

    await db
      .insert(usersTable)
      .values({ id: actor, email: "cancel-actor@soletrade-test.local", fullName: "Cancel Actor" });
    ws = await createWorkspace(actor, "Cancel Test", `cancel-test-${Date.now()}`);

    // The WorkspaceCreated subscriber that provisions the subscription row is wiped
    // by clearEventBus() above, so create it explicitly, then seed active billing state.
    await ensureSubscription(ws);
    const anchor = new Date(Date.now() - 5 * 86_400_000);
    await db
      .update(subscriptionsTable)
      .set({
        billingInterval: "monthly",
        status: "active",
        stripeSubscriptionId: "sub_test",
        stripeCustomerId: "cus_test",
        anchorBillingDate: anchor,
        updatedAt: new Date(),
      })
      .where(eq(subscriptionsTable.workspaceId, ws));

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
    const db = getDb();
    if (!ws) {
      await db.delete(usersTable).where(eq(usersTable.id, actor));
      return;
    }
    await db.delete(creditLedgerTable).where(eq(creditLedgerTable.workspaceId, ws));
    await db.delete(auditLogs).where(eq(auditLogs.workspaceId, ws));
    await db.delete(moduleInstallationsTable).where(eq(moduleInstallationsTable.workspaceId, ws));
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.workspaceId, ws));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws));
    await db.delete(usersTable).where(eq(usersTable.id, actor));
    clearEventBus();
  });

  async function getInstallation(key: string) {
    const db = getDb();
    const rows = await db
      .select({
        status: moduleInstallationsTable.status,
        cancelledAt: moduleInstallationsTable.cancelledAt,
        pendingCancellationAt: moduleInstallationsTable.pendingCancellationAt,
      })
      .from(moduleInstallationsTable)
      .where(
        and(
          eq(moduleInstallationsTable.workspaceId, ws!),
          eq(moduleInstallationsTable.moduleKey, key as never),
        ),
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
    expect(row?.cancelledAt).toBeNull();
    expect(row?.pendingCancellationAt).not.toBeNull();
    // Effective at is the period end (≈ 25 days from the 5-day-ago anchor).
    expect(res.effectiveAt?.getTime()).toBeGreaterThan(Date.now());

    // No ledger refund row was written.
    const db = getDb();
    const ledger = await db
      .select({ entryType: creditLedgerTable.entryType })
      .from(creditLedgerTable)
      .where(eq(creditLedgerTable.workspaceId, ws!));
    expect(ledger.length).toBe(0);

    // ModuleCancelled event fired with the keep option.
    const cancelled = collectedEvents.filter((e) => e.type === "ModuleCancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });

  it("finalizeModuleCancellations disables rows whose pendingCancellationAt has lapsed", async () => {
    // Force the scheduled timestamp into the past.
    const db = getDb();
    await db
      .update(moduleInstallationsTable)
      .set({ pendingCancellationAt: new Date(Date.now() - 86_400_000) })
      .where(
        and(
          eq(moduleInstallationsTable.workspaceId, ws!),
          eq(moduleInstallationsTable.moduleKey, "invoices" as never),
        ),
      );

    const count = await finalizeModuleCancellations(new Date());
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await getInstallation("invoices");
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelledAt).not.toBeNull();
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
    expect(row?.cancelledAt).not.toBeNull();

    // Ledger balance increased by the refund (append-only ledger).
    const after = await getCreditBalance(ws!);
    expect(after).toBe(before + res.refundCents);

    // A refund ledger row exists.
    const db = getDb();
    const ledger = await db
      .select({ entryType: creditLedgerTable.entryType, reason: creditLedgerTable.reason })
      .from(creditLedgerTable)
      .where(eq(creditLedgerTable.workspaceId, ws!));
    expect(ledger.some((r) => r.entryType === "refund")).toBe(true);
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
