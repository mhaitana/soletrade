import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { getDataClient } from "@/server/db/client";
import { unwrap, unwrapVoid } from "@/server/db/helpers";
import { cleanupWorkspaces, seedUsers, type CleanupTable } from "@/tests/db-helpers";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus } from "@/server/events";
import { ensureSubscription, getSubscription } from "@/platform/billing/subscriptions";
import { getInstalledModules } from "@/platform/module-installations";
import { getCreditBalance, listCreditLedger } from "@/platform/billing/credits";
import { reconcileFromCheckoutSession } from "@/platform/billing/reconcile";
import { handleStripeEvent, recordProcessedEvent } from "./handlers";

/**
 * Integration tests for the Stripe webhook dispatcher + reconcile handlers
 * against a real Postgres.
 *
 *   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" pnpm test:ci
 *
 * Skipped when DATABASE_URL is unset. Creates its own user + workspaces and cleans
 * everything up in `afterAll`. Uses synthetic Stripe objects (typed via
 * `as Stripe.*`) - no network, no real Stripe connection.
 *
 * The `checkout.session.completed` path in `handleStripeEvent` retrieves the
 * subscription from Stripe (to map price ids → modules), which synthetic events
 * can't satisfy. So checkout DB effects are tested by calling
 * `reconcileFromCheckoutSession(session, { interval, items })` directly - that's
 * the function the handler hands off to once it has resolved the items. The
 * non-checkout events (subscription.updated / .deleted / invoice.paid) carry
 * everything they need on the event object, so they go through `handleStripeEvent`.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("Stripe webhook handlers integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000b4");
  const workspaceIds: WorkspaceId[] = [];

  // Track every event id we create so afterAll can clean processed_webhook_events.
  const allEventIds: string[] = [];
  function makeEvent(type: string, id: string, object: unknown): Stripe.Event {
    allEventIds.push(id);
    return { id, type, data: { object } } as unknown as Stripe.Event;
  }

  async function freshWorkspace(slug: string): Promise<WorkspaceId> {
    const ws = await createWorkspace(
      actor,
      `Stripe Test ${slug}`,
      `stripe-test-${slug}-${Date.now()}`,
    );
    workspaceIds.push(ws);
    await ensureSubscription(ws);
    return ws;
  }

  /** Drive the checkout reconcile path directly with a chosen module set + interval. */
  async function startBilling(
    ws: WorkspaceId,
    slug: string,
    interval: "monthly" | "annual",
  ): Promise<void> {
    const session = {
      id: `cs_test_${slug}`,
      client_reference_id: String(ws),
      customer: `cus_test_${ws}`,
      subscription: `sub_test_${ws}`,
    } as Stripe.Checkout.Session;
    await reconcileFromCheckoutSession(session, {
      interval,
      items: [
        { moduleKey: "books", role: "standalone", itemId: `si_books_${slug}` },
        { moduleKey: "invoices", role: "addon", itemId: `si_invoices_${slug}` },
      ],
    });
  }

  beforeAll(async () => {
    clearEventBus();
    await seedUsers([
      { id: actor, email: "stripe-handler@soletrade-test.local", fullName: "Stripe Handler" },
    ]);
  });

  afterAll(async () => {
    // processed_webhook_events is keyed by stripe_event_id (NOT workspace-scoped), so purge
    // it directly before the workspace-scoped cascade. The remaining workspace-scoped tables
    // go through the shared cleanup helper (credit_ledger before workspaces or its FK blocks
    // the workspace delete).
    if (allEventIds.length > 0) {
      await unwrapVoid(
        getDataClient()
          .from("processed_webhook_events")
          .delete()
          .in("stripe_event_id", allEventIds),
      );
    }
    const tables: CleanupTable[] = [
      { table: "credit_ledger" },
      { table: "module_installations" },
      { table: "subscriptions" },
      { table: "audit_logs" },
    ];
    await cleanupWorkspaces(workspaceIds, [actor], tables);
    clearEventBus();
  });

  it("checkout reconcile marks the workspace active+monthly with Stripe ids + anchor + enables the chosen modules", async () => {
    const ws = await freshWorkspace("checkout");
    await startBilling(ws, "checkout", "monthly");

    const sub = await getSubscription(ws);
    expect(sub?.billingInterval).toBe("monthly");
    expect(sub?.status).toBe("active");
    expect(sub?.stripeCustomerId).toBe(`cus_test_${ws}`);
    expect(sub?.stripeSubscriptionId).toBe(`sub_test_${ws}`);
    expect(sub?.anchorBillingDate).not.toBeNull();

    const installed = await getInstalledModules(ws);
    expect(installed).toHaveLength(2);
    expect(installed).toContain("books");
    expect(installed).toContain("invoices");
  });

  it("a second delivery of the same event id is a no-op (pre-check idempotency)", async () => {
    const ws = await freshWorkspace("idempotent");
    // Use subscription.updated for the idempotency pre-check - it carries
    // everything on the event (no Stripe retrieve), and writes exactly one
    // audit row on the first delivery (status change active → past_due).
    const event = makeEvent("customer.subscription.updated", `evt_idempotent_${ws}`, {
      id: `sub_test_${ws}`,
      status: "past_due",
      metadata: { workspaceId: String(ws) },
    });

    await handleStripeEvent(event);
    await handleStripeEvent(event); // retry - should be a no-op

    const sub = await getSubscription(ws);
    expect(sub?.status).toBe("past_due");

    const auditRows = await unwrap(
      getDataClient().from("audit_logs").select("action").eq("workspace_id", ws),
    );
    const updateAudits = auditRows.filter((r) => r.action === "billing.subscription.update");
    expect(updateAudits.length).toBe(1);
  });

  it("customer.subscription.updated syncs the local status and leaves billingInterval unchanged", async () => {
    const ws = await freshWorkspace("subupdated");
    // Start billing first so the row has billingInterval=monthly to preserve.
    await startBilling(ws, "subupdated", "monthly");

    const updateEvent = makeEvent("customer.subscription.updated", `evt_subupdated_${ws}`, {
      id: `sub_test_${ws}`,
      status: "past_due",
      metadata: { workspaceId: String(ws) },
    });
    await handleStripeEvent(updateEvent);

    const sub = await getSubscription(ws);
    expect(sub?.status).toBe("past_due");
    expect(sub?.billingInterval).toBe("monthly"); // interval unchanged by status sync
  });

  it("customer.subscription.deleted marks canceled + clears billingInterval and cascade-disables modules", async () => {
    const ws = await freshWorkspace("subdeleted");
    // Start billing first so the cascade has active modules to disable.
    await startBilling(ws, "subdeleted", "monthly");

    const deleteEvent = makeEvent("customer.subscription.deleted", `evt_subdeleted_${ws}`, {
      id: `sub_test_${ws}`,
      status: "canceled",
      metadata: { workspaceId: String(ws) },
    });
    await handleStripeEvent(deleteEvent);

    const sub = await getSubscription(ws);
    expect(sub?.status).toBe("canceled");
    expect(sub?.billingInterval).toBeNull();
    expect(sub?.stripeSubscriptionId).toBe(`sub_test_${ws}`); // retained for audit trail

    const installed = await getInstalledModules(ws);
    expect(installed).toEqual([]); // cascade-disabled
  });

  it("invoice.paid writes one billing.invoice.paid audit row", async () => {
    const ws = await freshWorkspace("invoice");
    // Start billing first so the subscription row has a stripeCustomerId for
    // recordInvoicePaid to join on (it resolves the workspace by customer id).
    await startBilling(ws, "invoice", "monthly");

    const event = makeEvent("invoice.paid", `evt_invoice_${ws}`, {
      id: `in_test_${ws}`,
      amount_paid: 2250,
      currency: "aud",
      customer: `cus_test_${ws}`,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: `sub_test_${ws}` },
      },
    });
    await handleStripeEvent(event);

    const rows = await unwrap(
      getDataClient().from("audit_logs").select("action").eq("workspace_id", ws),
    );
    const invoiceAudits = rows.filter((r) => r.action === "billing.invoice.paid");
    expect(invoiceAudits.length).toBe(1);
  });

  it("recordProcessedEvent is idempotent (onConflictDoNothing)", async () => {
    const id = `evt_record_${Date.now()}`;
    allEventIds.push(id);
    await recordProcessedEvent(id, "invoice.paid");
    await recordProcessedEvent(id, "invoice.paid"); // duplicate - no-op
    const rows = await unwrap(
      getDataClient().from("processed_webhook_events").select("id").eq("stripe_event_id", id),
    );
    expect(rows.length).toBe(1);
  });

  it("invoice.paid grants credits equal to amount_paid (4c prepayment model)", async () => {
    const ws = await freshWorkspace("invoicegrant");
    await startBilling(ws, "invoicegrant", "monthly");

    const before = await getCreditBalance(ws, "AUD");
    expect(before).toBe(0);

    const event = makeEvent("invoice.paid", `evt_invoicegrant_${ws}`, {
      id: `in_grant_${ws}`,
      amount_paid: 2250,
      currency: "aud",
      customer: `cus_test_${ws}`,
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: `sub_test_${ws}` },
      },
    });
    await handleStripeEvent(event);

    const after = await getCreditBalance(ws, "AUD");
    expect(after).toBe(2250); // full invoice amount granted as credits
    const ledger = await listCreditLedger(ws, { limit: 10 });
    const grantRow = ledger.find((r) => r.reason === "invoice.paid");
    expect(grantRow).toBeDefined();
    expect(grantRow?.amountCents).toBe(2250);
    expect(grantRow?.stripeInvoiceId).toBe(`in_grant_${ws}`);
  });

  it("invoice.paid does not double-grant when a different event id carries the same invoice id", async () => {
    const ws = await freshWorkspace("invoiceidem");
    await startBilling(ws, "invoiceidem", "monthly");
    const invoiceId = `in_idem_${ws}`;

    // First delivery: event A.
    await handleStripeEvent(
      makeEvent("invoice.paid", `evt_invoiceidem_a_${ws}`, {
        id: invoiceId,
        amount_paid: 3000,
        currency: "aud",
        customer: `cus_test_${ws}`,
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: `sub_test_${ws}` },
        },
      }),
    );
    // Second delivery: different event id, SAME invoice id - must NOT double-grant.
    await handleStripeEvent(
      makeEvent("invoice.paid", `evt_invoiceidem_b_${ws}`, {
        id: invoiceId,
        amount_paid: 3000,
        currency: "aud",
        customer: `cus_test_${ws}`,
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: `sub_test_${ws}` },
        },
      }),
    );

    const balance = await getCreditBalance(ws, "AUD");
    expect(balance).toBe(3000); // granted once, not twice
    const grantRows = await unwrap(
      getDataClient().from("credit_ledger").select("id").eq("workspace_id", ws),
    );
    const grants = grantRows.length;
    expect(grants).toBe(1);
  });

  it("customer.subscription.deleted issues a prorated refund row per active module (4c)", async () => {
    const ws = await freshWorkspace("subrefund");
    // Start billing with books (anchor) + invoices (addon) - both active this cycle.
    await startBilling(ws, "subrefund", "monthly");

    const deleteEvent = makeEvent("customer.subscription.deleted", `evt_subrefund_${ws}`, {
      id: `sub_test_${ws}`,
      status: "canceled",
      metadata: { workspaceId: String(ws) },
    });
    await handleStripeEvent(deleteEvent);

    const ledger = await listCreditLedger(ws, { limit: 50 });
    const refundRows = ledger.filter((r) => r.reason === "subscription.cancel.refund");
    // One refund per active module (books + invoices = 2).
    expect(refundRows.length).toBe(2);
    const refundKeys = new Set(refundRows.map((r) => r.moduleKey));
    expect(refundKeys.has("books")).toBe(true);
    expect(refundKeys.has("invoices")).toBe(true);
    // Just-started billing → nearly the full period remains → refunds should be positive.
    for (const r of refundRows) {
      expect(r.amountCents).toBeGreaterThan(0);
    }
    // Balance reflects the refunds (no invoice grants in this workspace).
    const balance = await getCreditBalance(ws, "AUD");
    expect(balance).toBeGreaterThan(0);
    // The subscription row is canceled with billingInterval cleared.
    const sub = await getSubscription(ws);
    expect(sub?.status).toBe("canceled");
    expect(sub?.billingInterval).toBeNull();
  });
});
