import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  customers as customersTable,
  invoiceLineItems,
  invoices as invoicesTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type CustomerId, type InvoiceId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createCustomer } from "@/platform/customers";
import { onEvent } from "@/server/events";
import {
  createInvoice,
  getInvoice,
  getInvoiceByPublicToken,
  markInvoicePaidByStripe,
  markInvoiceViewed,
  markOverdueInvoices,
  sendInvoice,
} from "./index";

/**
 * Integration tests for the 5b public-payment service surface against a real Postgres.
 * Skipped without DATABASE_URL (keeps `pnpm test:ci` green in environments without a DB).
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("invoices public payment (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-6000-8000-0000000000b1");
  let ws: WorkspaceId;
  let customer: CustomerId;
  const createdInvoiceIds: InvoiceId[] = [];
  const captured: { type: string; invoiceId?: string; metadata?: Record<string, unknown> }[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values({
      id: actor,
      email: "pub-actor@soletrade-test.local",
      fullName: "Pub Actor",
    });
    ws = await createWorkspace(actor, "Pub Test", `pub-test-${Date.now()}`);
    customer = await createCustomer(
      ws,
      { name: "Globex Corp", email: "globex@soletrade-test.local" },
      actor,
    );

    // Capture invoice lifecycle events published by the service.
    const u1 = onEvent("InvoiceViewed", (e) => {
      captured.push({ type: "InvoiceViewed", invoiceId: e.entityId });
    });
    const u2 = onEvent("InvoiceOverdue", (e) => {
      captured.push({ type: "InvoiceOverdue", invoiceId: e.entityId });
    });
    const u3 = onEvent("InvoiceSent", (e) => {
      captured.push({
        type: "InvoiceSent",
        invoiceId: e.entityId,
        metadata: e.metadata as Record<string, unknown>,
      });
    });
    unsub = () => {
      u1();
      u2();
      u3();
    };
  });

  afterAll(async () => {
    const db = getDb();
    unsub?.();
    const workspaceIds = [ws!].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) return;
    await db.delete(invoicesTable).where(inArray(invoicesTable.workspaceId, workspaceIds));
    await db.delete(invoiceLineItems).where(inArray(invoiceLineItems.workspaceId, workspaceIds));
    await db.delete(customersTable).where(inArray(customersTable.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(inArray(usersTable.id, [actor]));
  });

  async function createSentInvoice(opts?: {
    dueDate?: Date;
  }): Promise<{ id: InvoiceId; token: string }> {
    const id = await createInvoice(
      ws!,
      {
        customerId: customer,
        issueDate: new Date("2026-01-10"),
        dueDate: opts?.dueDate ?? null,
        taxRate: 10,
        lineItems: [{ description: "Job", quantity: 1, unitPriceCents: 10000 }],
      },
      actor,
    );
    createdInvoiceIds.push(id);
    await sendInvoice(ws!, id, actor);
    const inv = await getInvoice(ws!, id);
    if (!inv?.publicToken) throw new Error("sendInvoice did not set publicToken");
    return { id, token: inv.publicToken };
  }

  it("getInvoiceByPublicToken returns null for an unknown token", async () => {
    expect(await getInvoiceByPublicToken("does-not-exist")).toBeNull();
  });

  it("sendInvoice enriches InvoiceSent with the email-render context (5c)", async () => {
    const { id } = await createSentInvoice();
    const evt = captured.find((e) => e.type === "InvoiceSent" && e.invoiceId === id);
    expect(evt).toBeDefined();
    // The notifications platform renders an email from this metadata — it needs the public
    // token (link), customer email (recipient), and the amount/number for the body.
    expect(evt?.metadata?.publicToken).toMatch(/.+/);
    expect(evt?.metadata?.customerEmail).toBe("globex@soletrade-test.local");
    expect(evt?.metadata?.customerName).toBe("Globex Corp");
    expect(evt?.metadata?.totalCents).toBe(11000);
    expect(evt?.metadata?.currency).toBe("AUD");
  });

  it("getInvoiceByPublicToken returns a sanitized view (no internal ids)", async () => {
    const { token } = await createSentInvoice();
    const view = await getInvoiceByPublicToken(token);
    expect(view).not.toBeNull();
    // No workspace-internal ids leak into the public shape.
    expect(view).not.toHaveProperty("workspaceId");
    expect(view).not.toHaveProperty("customerId");
    expect(view).not.toHaveProperty("id");
    expect(view).not.toHaveProperty("publicToken");
    expect(view!.customerName).toBe("Globex Corp");
    expect(view!.lineItems).toHaveLength(1);
    expect(view!.totalCents).toBe(11000); // 10000 + 10% tax
    expect(view!.stripeChargeId).toBeNull();
  });

  it("markInvoiceViewed flips sent→viewed idempotently and publishes InvoiceViewed", async () => {
    const { id, token } = await createSentInvoice();
    const first = await markInvoiceViewed(token);
    expect(first).toBe(true);
    const second = await markInvoiceViewed(token);
    expect(second).toBe(false); // already viewed — no-op, no duplicate event
    const inv = await getInvoice(ws!, id);
    expect(inv!.status).toBe("viewed");
    expect(captured.filter((e) => e.type === "InvoiceViewed" && e.invoiceId === id)).toHaveLength(
      1,
    );
  });

  it("markInvoicePaidByStripe flips viewed→paid, stores ids, is idempotent", async () => {
    const { id, token } = await createSentInvoice();
    await markInvoiceViewed(token); // sent → viewed

    const ok = await markInvoicePaidByStripe(ws!, id, "pi_test_123", "ch_test_456");
    expect(ok).toBe(true);
    const inv = await getInvoice(ws!, id);
    expect(inv!.status).toBe("paid");
    expect(inv!.paidAt).not.toBeNull();
    expect(inv!.stripePaymentIntentId).toBe("pi_test_123");
    expect(inv!.stripeChargeId).toBe("ch_test_456");

    // Idempotent: a second call (e.g. a redelivered webhook) is a no-op.
    const again = await markInvoicePaidByStripe(ws!, id, "pi_test_123", "ch_test_456");
    expect(again).toBe(false);
  });

  it("markInvoicePaidByStripe flips overdue→paid (overdue is not terminal)", async () => {
    const { id, token } = await createSentInvoice({ dueDate: new Date("2020-01-01") });
    // Force overdue via the batch job (due date is in the past).
    const marked = await markOverdueInvoices(new Date("2026-06-01"));
    expect(marked).toBeGreaterThanOrEqual(1);
    const inv = await getInvoice(ws!, id);
    expect(inv!.status).toBe("overdue");
    expect(captured.some((e) => e.type === "InvoiceOverdue" && e.invoiceId === id)).toBe(true);

    const ok = await markInvoicePaidByStripe(ws!, id, "pi_test_late", "ch_test_late");
    expect(ok).toBe(true);
    const after = await getInvoice(ws!, id);
    expect(after!.status).toBe("paid");
    // token + public view still resolve after the overdue→paid transition
    expect(await getInvoiceByPublicToken(token)).not.toBeNull();
  });

  it("markOverdueInvoices leaves a not-yet-due sent invoice alone", async () => {
    const { id } = await createSentInvoice({ dueDate: new Date("2099-01-01") });
    const marked = await markOverdueInvoices(new Date("2026-06-01"));
    // something may be marked from prior tests, but THIS invoice must not be one of them
    const inv = await getInvoice(ws!, id);
    expect(inv!.status).toBe("sent");
    expect(captured.some((e) => e.type === "InvoiceOverdue" && e.invoiceId === id)).toBe(false);
    // marked count is >= 0 (the call shouldn't throw); just assert type
    expect(typeof marked).toBe("number");
  });
});
