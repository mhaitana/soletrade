import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers, type CleanupTable } from "@/testing/db-helpers";
import {
  branded,
  type CustomerId,
  type InvoiceId,
  type QuoteId,
  type WorkspaceId,
} from "@/types/ids";
import { createWorkspace } from "@/server/foundation/workspaces";
import { createCustomer } from "@/server/foundation/customers";
import { clearEventBus, onEvent } from "@/server/infrastructure/events";
import {
  acceptQuote,
  createQuote,
  declineQuote,
  getAcceptance,
  getQuote,
  getQuoteByPublicToken,
  markExpiredQuotes,
  markQuoteConverted,
  markQuoteViewed,
  sendQuote,
} from "@/server/domains/quotes";
import { type AcceptanceMeta, type DeclineMeta } from "@/lib/domain/quotes/types";
import { createInvoice, getInvoice } from "@/server/domains/invoices";

/** Canned acceptance metadata for tests (Wave 2 - acceptQuote now requires it). */
const ACCEPT_META: AcceptanceMeta = {
  accepterName: "Jane Buyer",
  accepterEmail: "jane@globex.com",
  signature: "Jane Buyer",
  ipAddress: "203.0.113.7",
  userAgent: "TestUA/1.0",
};
const DECLINE_META: DeclineMeta = { ipAddress: "203.0.113.7", userAgent: "TestUA/1.0" };

/**
 * Integration tests for the Quotes public-page + lifecycle transitions (accept / decline /
 * convert / expire) against a real Postgres. Run only when DATABASE_URL is set; skipped
 * otherwise.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("quotes public + transitions (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-9000-8000-0000000000f1");
  let ws: WorkspaceId;
  let cust: CustomerId;

  const captured: { type: string; entityId?: string; metadata?: Record<string, unknown> }[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "quotes-public@soletrade-test.local", fullName: "Quotes Public" },
    ]);
    ws = await createWorkspace(actor, "Quotes Public", `quotes-public-${Date.now()}`);
    cust = await createCustomer(ws, { name: "Globex Corp", email: "buyer@globex.com" }, actor);

    const types = [
      "QuoteSent",
      "QuoteViewed",
      "QuoteAccepted",
      "QuoteDeclined",
      "QuoteConvertedToInvoice",
      "QuoteExpired",
    ];
    const unsubs = types.map((t) =>
      onEvent(t, (e) => {
        captured.push({
          type: t,
          entityId: e.entityId,
          metadata: e.metadata as Record<string, unknown> | undefined,
        });
      }),
    );
    unsub = () => unsubs.forEach((u) => u());
  });

  afterAll(async () => {
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws!].filter(Boolean) as WorkspaceId[];
    // invoice_line_items cascade on invoices; quotes' line items cascade on quotes.
    const tables: CleanupTable[] = [
      { table: "invoices" },
      { table: "quotes" },
      { table: "customers" },
      { table: "audit_logs" },
    ];
    await cleanupWorkspaces(workspaceIds, [actor], tables);
  });

  function capturedOf(type: string, entityId?: string) {
    return captured.filter((e) => e.type === type && (entityId ? e.entityId === entityId : true));
  }

  /** Create + send a quote; returns the quote id + public token. */
  async function sendFreshQuote(
    overrides: { validUntil?: Date | null; customerId?: CustomerId | null } = {},
  ): Promise<{ id: QuoteId; token: string }> {
    const id = await createQuote(
      ws!,
      {
        customerId: overrides.customerId ?? cust,
        issueDate: new Date("2026-07-01"),
        validUntil: overrides.validUntil ?? null,
        taxRate: 10,
        lineItems: [{ description: "Service", quantity: 2, unitPriceCents: 5000 }],
      },
      actor,
    );
    await sendQuote(ws!, id, actor);
    const q = await getQuote(ws!, id);
    return { id, token: q!.publicToken! };
  }

  it("getQuoteByPublicToken returns null for unknown / draft / expired / converted / declined", async () => {
    // Unknown token.
    expect(await getQuoteByPublicToken("does-not-exist")).toBeNull();

    // Draft (no token yet).
    const draftId = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-01"),
        taxRate: 0,
        lineItems: [{ description: "D", quantity: 1, unitPriceCents: 100 }],
      },
      actor,
    );
    const draft = await getQuote(ws!, draftId);
    expect(await getQuoteByPublicToken(draft!.publicToken ?? "none")).toBeNull();
  });

  it("getQuoteByPublicToken returns a sanitized view (no internal ids / notes / token)", async () => {
    const { token } = await sendFreshQuote();
    const pub = await getQuoteByPublicToken(token);
    expect(pub).not.toBeNull();
    expect(pub!.number).toMatch(/^QUO-\d{4}-\d{4}$/);
    expect(pub!.status).toBe("sent");
    expect(pub!.customerName).toBe("Globex Corp");
    // The issuing business (workspace) name is the dominant brand on the public page.
    expect(pub!.merchantName).toBe("Quotes Public");
    expect(pub!.lineItems).toHaveLength(1);
    expect(pub!.lineItems[0]).toEqual({
      description: "Service",
      quantity: 2,
      unitPriceCents: 5000,
      amountCents: 10000,
    });
    // Sanitized - no internal ids / notes / publicToken / workspaceId.
    expect("notes" in pub!).toBe(false);
    expect("publicToken" in pub!).toBe(false);
    expect("workspaceId" in pub!).toBe(false);
    expect("customerId" in pub!).toBe(false);
  });

  it("markQuoteViewed flips sent → viewed (idempotent + one QuoteViewed event)", async () => {
    const { id, token } = await sendFreshQuote();
    const ok1 = await markQuoteViewed(token);
    expect(ok1).toBe(true);
    expect(capturedOf("QuoteViewed", id)).toHaveLength(1);

    // Second view is a no-op (already viewed) - no duplicate event.
    const ok2 = await markQuoteViewed(token);
    expect(ok2).toBe(false);
    expect(capturedOf("QuoteViewed", id)).toHaveLength(1);

    const q = await getQuote(ws!, id);
    expect(q!.status).toBe("viewed");
  });

  it("acceptQuote flips sent → accepted + fires QuoteAccepted", async () => {
    const { id, token } = await sendFreshQuote();
    const ok = await acceptQuote(token, ACCEPT_META);
    expect(ok).toBe(true);
    const q = await getQuote(ws!, id);
    expect(q!.status).toBe("accepted");
    expect(q!.acceptedAt).toBeInstanceOf(Date);
    const evts = capturedOf("QuoteAccepted", id);
    expect(evts).toHaveLength(1);
    expect(evts[0]?.metadata).toMatchObject({
      number: q!.number,
      totalCents: q!.totalCents,
      currency: "AUD",
      customerName: "Globex Corp",
      customerEmail: "buyer@globex.com",
      accepterName: "Jane Buyer",
      ipAddress: "203.0.113.7",
    });
    // Wave 2 - acceptance row written with the accepter evidence.
    const acc = await getAcceptance(ws!, id);
    expect(acc).not.toBeNull();
    expect(acc!.accepterName).toBe("Jane Buyer");
    expect(acc!.ipAddress).toBe("203.0.113.7");
    expect(acc!.userAgent).toBe("TestUA/1.0");
    expect(acc!.signature).toBe("Jane Buyer");
  });

  it("acceptQuote from a viewed quote also works (sent|viewed → accepted)", async () => {
    const { id, token } = await sendFreshQuote();
    await markQuoteViewed(token); // → viewed
    const ok = await acceptQuote(token, ACCEPT_META);
    expect(ok).toBe(true);
    expect((await getQuote(ws!, id))!.status).toBe("accepted");
  });

  it("declineQuote flips sent → declined + fires QuoteDeclined (terminal)", async () => {
    const { id, token } = await sendFreshQuote();
    const ok = await declineQuote(token, DECLINE_META);
    expect(ok).toBe(true);
    const q = await getQuote(ws!, id);
    expect(q!.status).toBe("declined");
    expect(q!.declinedAt).toBeInstanceOf(Date);
    expect(capturedOf("QuoteDeclined", id)).toHaveLength(1);

    // Declined is terminal - a subsequent accept is a no-op.
    const reAccept = await acceptQuote(token, ACCEPT_META);
    expect(reAccept).toBe(false);
    expect((await getQuote(ws!, id))!.status).toBe("declined");

    // Declined quotes are no longer publicly viewable.
    expect(await getQuoteByPublicToken(token)).toBeNull();
  });

  it("markQuoteConverted flips accepted → converted + stores convertedInvoiceId + fires event", async () => {
    const { id } = await sendFreshQuote();
    await acceptQuote((await getQuote(ws!, id))!.publicToken!, ACCEPT_META);

    // The convert action layer orchestrates createInvoice + markQuoteConverted; here we
    // exercise the service primitives directly (mirrors what the action does).
    const invoiceId = await createInvoice(
      ws!,
      {
        customerId: cust,
        issueDate: new Date("2026-07-05"),
        dueDate: null,
        currency: "AUD",
        taxRate: 10,
        notes: "Converted from quote.",
        lineItems: [{ description: "Service", quantity: 2, unitPriceCents: 5000 }],
      },
      actor,
    );
    const invoice = await getInvoice(ws!, invoiceId);
    const ok = await markQuoteConverted(ws!, id, invoiceId as InvoiceId, invoice!.number, actor);
    expect(ok).toBe(true);

    const q = await getQuote(ws!, id);
    expect(q!.status).toBe("converted");
    expect(q!.convertedInvoiceId).toBe(invoiceId);
    expect(q!.convertedAt).toBeInstanceOf(Date);

    const evts = capturedOf("QuoteConvertedToInvoice", id);
    expect(evts).toHaveLength(1);
    expect(evts[0]?.metadata).toMatchObject({
      quoteNumber: q!.number,
      invoiceId,
      invoiceNumber: invoice!.number,
    });

    // Converted is terminal - re-converting is a no-op.
    const reConvert = await markQuoteConverted(
      ws!,
      id,
      invoiceId as InvoiceId,
      invoice!.number,
      actor,
    );
    expect(reConvert).toBe(false);
  });

  it("markQuoteConverted refuses a non-accepted quote (no-op)", async () => {
    const { id } = await sendFreshQuote(); // status: sent
    const fakeInvoiceId = branded<"InvoiceId">("00000000-0000-9000-8000-00000000f0ff");
    const ok = await markQuoteConverted(ws!, id, fakeInvoiceId, "INV-2026-9999", actor);
    expect(ok).toBe(false);
    const q = await getQuote(ws!, id);
    expect(q!.status).toBe("sent");
    expect(q!.convertedInvoiceId).toBeNull();
  });

  it("markExpiredQuotes flips sent/viewed past validUntil → expired + fires QuoteExpired; leaves others", async () => {
    const past = new Date("2020-01-01");
    const future = new Date("2099-01-01");

    // Sent + past validUntil → should expire.
    const expirable = await sendFreshQuote({ validUntil: past });
    // Viewed + past validUntil → should expire.
    const viewedExpirable = await sendFreshQuote({ validUntil: past });
    await markQuoteViewed(viewedExpirable.token);
    // Sent + future validUntil → should NOT expire.
    const notYetDue = await sendFreshQuote({ validUntil: future });
    // Sent + no validUntil → should NOT expire (no expiry date set).
    const noExpiry = await sendFreshQuote({ validUntil: null });
    // Accepted + past validUntil → should NOT expire (accepted quotes don't expire).
    const accepted = await sendFreshQuote({ validUntil: past });
    await acceptQuote(accepted.token, ACCEPT_META);

    const beforeExpired = capturedOf("QuoteExpired").length;
    const now = new Date("2026-07-10T00:00:00Z");
    const marked = await markExpiredQuotes(now);
    expect(marked).toBeGreaterThanOrEqual(2); // expirable + viewedExpirable

    expect((await getQuote(ws!, expirable.id))!.status).toBe("expired");
    expect((await getQuote(ws!, viewedExpirable.id))!.status).toBe("expired");
    expect((await getQuote(ws!, notYetDue.id))!.status).toBe("sent");
    expect((await getQuote(ws!, noExpiry.id))!.status).toBe("sent");
    expect((await getQuote(ws!, accepted.id))!.status).toBe("accepted");

    // Each expired quote fired one QuoteExpired.
    expect(capturedOf("QuoteExpired", expirable.id)).toHaveLength(1);
    expect(capturedOf("QuoteExpired", viewedExpirable.id)).toHaveLength(1);
    expect(capturedOf("QuoteExpired").length).toBe(beforeExpired + 2);
  });

  it("acceptQuote on an expired quote is a no-op (terminal)", async () => {
    const past = new Date("2020-01-01");
    const { id, token } = await sendFreshQuote({ validUntil: past });
    await markExpiredQuotes(new Date("2026-07-10T00:00:00Z"));
    expect((await getQuote(ws!, id))!.status).toBe("expired");
    const ok = await acceptQuote(token, ACCEPT_META);
    expect(ok).toBe(false);
    expect((await getQuote(ws!, id))!.status).toBe("expired");
  });

  it("markExpiredQuotes is idempotent (re-running flips nothing)", async () => {
    const past = new Date("2020-01-01");
    const { id } = await sendFreshQuote({ validUntil: past });
    const now = new Date("2026-07-11T00:00:00Z");
    await markExpiredQuotes(now);
    expect((await getQuote(ws!, id))!.status).toBe("expired");
    const before = capturedOf("QuoteExpired", id).length;
    const marked = await markExpiredQuotes(now);
    expect(marked).toBe(0); // already expired - no new flips
    expect(capturedOf("QuoteExpired", id).length).toBe(before);
  });
});
