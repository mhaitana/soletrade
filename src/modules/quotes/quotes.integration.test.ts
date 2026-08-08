import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/db/client";
import { unwrap } from "@/server/db/helpers";
import { cleanupWorkspaces, seedUsers, type CleanupTable } from "@/tests/db-helpers";
import { branded, type CustomerId, type QuoteId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createCustomer } from "@/platform/customers";
import { clearEventBus, onEvent } from "@/server/events";
import {
  createQuote,
  deleteQuote,
  getQuote,
  getQuoteDashboardSummary,
  listQuotes,
  updateQuote,
  sendQuote,
} from "./index";
import { summarizeQuotes } from "./calc";

/**
 * Integration tests for the Quotes service against a real Postgres. Run only when
 * DATABASE_URL is set; skipped otherwise (keeps `pnpm test:ci` green without a DB).
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("quotes integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-8000-8000-0000000000e1");
  const otherActor = branded<"UserId">("00000000-0000-8000-8000-0000000000e2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  let cust1: CustomerId;
  const createdQuoteIds: QuoteId[] = [];

  const captured: { type: string; entityId?: string; metadata?: Record<string, unknown> }[] = [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "quotes-actor@soletrade-test.local", fullName: "Quotes Actor" },
      { id: otherActor, email: "quotes-other@soletrade-test.local", fullName: "Quotes Other" },
    ]);
    ws1 = await createWorkspace(actor, "Quotes Test One", `quotes-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Quotes Test Two", `quotes-test-two-${Date.now()}`);
    cust1 = await createCustomer(ws1, { name: "Acme Corp", email: "acme@globex.com" }, actor);

    unsub = onEvent("QuoteSent", (e) => {
      captured.push({
        type: "QuoteSent",
        entityId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
  });

  afterAll(async () => {
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    const tables: CleanupTable[] = [
      // quote_line_items + quote_sections cascade from quotes (FK ON DELETE CASCADE).
      { table: "quotes" },
      { table: "customers" },
      { table: "audit_logs" },
    ];
    await cleanupWorkspaces(workspaceIds, [actor, otherActor], tables);
  });

  it("creates a draft quote with the stored fields + line items (no event - audit only)", async () => {
    const before = captured.length;
    const id = await createQuote(
      ws1!,
      {
        customerId: cust1,
        issueDate: new Date("2026-07-01"),
        validUntil: new Date("2026-08-15"),
        currency: "AUD",
        taxRate: 10,
        notes: "Private note",
        lineItems: [
          { description: "Design work", quantity: 5, unitPriceCents: 8000 },
          { description: "Hosting", quantity: 1, unitPriceCents: 12000 },
        ],
      },
      actor,
    );
    createdQuoteIds.push(id);

    const q = await getQuote(ws1!, id);
    expect(q).not.toBeNull();
    expect(q!.number).toMatch(/^QUO-\d{4}-\d{4}$/);
    expect(q!.status).toBe("draft");
    expect(q!.customerId).toBe(cust1);
    expect(q!.customerName).toBe("Acme Corp");
    expect(q!.validUntil?.toISOString()).toBe(new Date("2026-08-15").toISOString());
    expect(q!.taxRate).toBe(10);
    expect(q!.subtotalCents).toBe(52000); // 5*8000 + 1*12000
    expect(q!.taxCents).toBe(5200); // 10% of 52000
    expect(q!.totalCents).toBe(57200);
    expect(q!.notes).toBe("Private note");
    expect(q!.lineItems).toHaveLength(2);
    expect(q!.lineItems[0]!.description).toBe("Design work");
    expect(q!.lineItems[0]!.amountCents).toBe(40000);

    // Draft creation is audit-only - no QuoteSent event.
    expect(captured.length).toBe(before);
  });

  it("rejects a quote with no line items", async () => {
    await expect(
      createQuote(ws1!, { issueDate: new Date("2026-07-01"), taxRate: 0, lineItems: [] }, actor),
    ).rejects.toThrow(/at least one line item/i);
  });

  it("rejects a quote whose customer belongs to another workspace (IDOR guard)", async () => {
    await expect(
      createQuote(
        ws2!,
        {
          customerId: cust1,
          issueDate: new Date("2026-07-01"),
          taxRate: 0,
          lineItems: [{ description: "X", quantity: 1, unitPriceCents: 1000 }],
        },
        otherActor,
      ),
    ).rejects.toThrow(/Customer not found in this workspace/i);
  });

  it("isolates quotes per workspace (no IDOR)", async () => {
    const cross = await getQuote(ws2!, createdQuoteIds[0]!);
    expect(cross).toBeNull();

    const ws1List = await listQuotes(ws1!);
    const ws2List = await listQuotes(ws2!);
    expect(ws1List.some((q) => q.id === createdQuoteIds[0])).toBe(true);
    expect(ws2List.some((q) => q.id === createdQuoteIds[0])).toBe(false);
  });

  it("updates a draft quote and recomputes totals", async () => {
    await updateQuote(
      ws1!,
      createdQuoteIds[0]!,
      {
        taxRate: 0,
        lineItems: [{ description: "Solo line", quantity: 2, unitPriceCents: 5000 }],
      },
      actor,
    );
    const q = await getQuote(ws1!, createdQuoteIds[0]!);
    expect(q!.taxRate).toBe(0);
    expect(q!.subtotalCents).toBe(10000);
    expect(q!.taxCents).toBe(0);
    expect(q!.totalCents).toBe(10000);
    expect(q!.lineItems).toHaveLength(1);
    expect(q!.lineItems[0]!.description).toBe("Solo line");
  });

  it("refuses to edit a quote that is not a draft", async () => {
    await sendQuote(ws1!, createdQuoteIds[0]!, actor);
    await expect(updateQuote(ws1!, createdQuoteIds[0]!, { taxRate: 5 }, actor)).rejects.toThrow(
      /Only draft quotes can be edited/i,
    );
    const q = await getQuote(ws1!, createdQuoteIds[0]!);
    expect(q!.status).toBe("sent");
    expect(q!.taxRate).toBe(0); // unchanged
  });

  it("sendQuote sets a publicToken + fires QuoteSent enriched with email context", async () => {
    const before = captured.filter((e) => e.type === "QuoteSent").length;
    // Create + send a fresh quote.
    const id = await createQuote(
      ws1!,
      {
        customerId: cust1,
        issueDate: new Date("2026-07-02"),
        validUntil: new Date("2026-09-01"),
        taxRate: 10,
        lineItems: [{ description: "Consulting", quantity: 3, unitPriceCents: 10000 }],
      },
      actor,
    );
    createdQuoteIds.push(id);
    const ok = await sendQuote(ws1!, id, actor);
    expect(ok).toBe(true);

    const q = await getQuote(ws1!, id);
    expect(q!.status).toBe("sent");
    expect(q!.publicToken).toBeTruthy();
    expect(q!.sentAt).toBeInstanceOf(Date);

    const evt = captured.find((e) => e.type === "QuoteSent" && e.entityId === id);
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({
      number: q!.number,
      totalCents: 33000,
      currency: "AUD",
      publicToken: q!.publicToken,
      customerEmail: "acme@globex.com",
      customerName: "Acme Corp",
    });
    expect(captured.filter((e) => e.type === "QuoteSent").length).toBe(before + 1);
  });

  it("filters quotes by status and search", async () => {
    const drafts = await listQuotes(ws1!, { status: "draft" });
    expect(drafts.every((q) => q.status === "draft")).toBe(true);
    const sent = await listQuotes(ws1!, { status: "sent" });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((q) => q.status === "sent")).toBe(true);
    const byCustomer = await listQuotes(ws1!, { search: "Acme" });
    expect(byCustomer.length).toBeGreaterThan(0);
    expect(byCustomer.some((q) => q.customerName === "Acme Corp")).toBe(true);
  });

  it("returns uncapped dashboard aggregates from Postgres", async () => {
    const end = new Date("2030-01-01T00:00:00Z");
    const rows = await listQuotes(ws1!, { limit: 2000 });
    const expected = summarizeQuotes(
      rows.map((row) => ({
        status: row.status,
        totalCents: row.totalCents,
        sentAt: row.sentAt,
        acceptedAt: row.acceptedAt,
        declinedAt: row.declinedAt,
        convertedAt: row.convertedAt,
        issueDate: row.issueDate,
      })),
      { start: null, end },
    );
    const summary = await getQuoteDashboardSummary(ws1!, { start: null, end });

    expect(summary).toMatchObject(expected);
    expect(summary.readyCount).toBe(rows.filter((row) => row.status === "accepted").length);
  });

  it("deletes a draft quote (and refuses non-drafts)", async () => {
    const id = await createQuote(
      ws1!,
      {
        issueDate: new Date("2026-07-03"),
        taxRate: 0,
        lineItems: [{ description: "Del", quantity: 1, unitPriceCents: 100 }],
      },
      actor,
    );
    const ok = await deleteQuote(ws1!, id, actor);
    expect(ok).toBe(true);
    expect(await getQuote(ws1!, id)).toBeNull();

    // Deleting from another workspace returns false (not found there).
    const refused = await deleteQuote(ws2!, createdQuoteIds[0]!, otherActor);
    expect(refused).toBe(false);
  });
});

/** Helper used by the missing-customer-flow test below - kept outside the suite. */
async function countQuotesForWorkspace(workspaceId: WorkspaceId): Promise<number> {
  const rows = await unwrap(
    getDataClient().from("quotes").select("id").eq("workspace_id", workspaceId),
  );
  return rows.length;
}

describe.skipIf(!HAS_DB)("quotes walk-in + numbering (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-8000-8000-0000000000e3");
  let ws: WorkspaceId;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "quotes-walkin@soletrade-test.local", fullName: "Quotes Walkin" },
    ]);
    ws = await createWorkspace(actor, "Quotes Walkin", `quotes-walkin-${Date.now()}`);
  });

  afterAll(async () => {
    const workspaceIds = [ws!].filter(Boolean) as WorkspaceId[];
    const tables: CleanupTable[] = [{ table: "quotes" }, { table: "audit_logs" }];
    await cleanupWorkspaces(workspaceIds, [actor], tables);
  });

  it("creates a walk-in quote (no customer)", async () => {
    const id = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-01"),
        taxRate: 0,
        lineItems: [{ description: "Walk-in", quantity: 1, unitPriceCents: 5000 }],
      },
      actor,
    );
    const q = await getQuote(ws!, id);
    expect(q!.customerId).toBeNull();
    expect(q!.customerName).toBeNull();
    expect(q!.totalCents).toBe(5000);
  });

  it("numbers quotes sequentially per workspace (QUO-YYYY-NNNN)", async () => {
    const a = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-02"),
        taxRate: 0,
        lineItems: [{ description: "A", quantity: 1, unitPriceCents: 100 }],
      },
      actor,
    );
    const b = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-03"),
        taxRate: 0,
        lineItems: [{ description: "B", quantity: 1, unitPriceCents: 100 }],
      },
      actor,
    );
    const qa = await getQuote(ws!, a);
    const qb = await getQuote(ws!, b);
    expect(qa!.number).not.toBe(qb!.number);
    // Same year prefix.
    const year = new Date().getFullYear();
    expect(qa!.number).toMatch(new RegExp(`^QUO-${year}-\\d{4}$`));
    expect(qb!.number).toMatch(new RegExp(`^QUO-${year}-\\d{4}$`));
  });

  // Reference the helper so it isn't tree-shakened from the file.
  it("counts quotes for the workspace", async () => {
    const n = await countQuotesForWorkspace(ws!);
    expect(n).toBeGreaterThanOrEqual(3); // walk-in + A + B
  });
});

describe.skipIf(!HAS_DB)("quotes sections + terms & conditions (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-8000-8000-0000000000e4");
  let ws: WorkspaceId;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "quotes-sections@soletrade-test.local", fullName: "Quotes Sections" },
    ]);
    ws = await createWorkspace(actor, "Quotes Sections", `quotes-sections-${Date.now()}`);
  });

  afterAll(async () => {
    const workspaceIds = [ws!].filter(Boolean) as WorkspaceId[];
    // quote_sections + quote_acceptances cascade from quotes (FK ON DELETE CASCADE).
    const tables: CleanupTable[] = [{ table: "quotes" }, { table: "audit_logs" }];
    await cleanupWorkspaces(workspaceIds, [actor], tables);
  });

  it("persists sections (in position order) + terms & conditions on create", async () => {
    const id = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-01"),
        taxRate: 0,
        lineItems: [{ description: "Service", quantity: 1, unitPriceCents: 10000 }],
        termsConditions: "Full payment due on acceptance. 50% deposit non-refundable.",
        sections: [
          { title: "Scope", body: "Design + build of the landing page." },
          { title: "Optional: Hosting", body: "Monthly managed hosting.", optional: true },
          { title: "Timeline", body: "2 weeks from kickoff." },
        ],
      },
      actor,
    );
    const q = await getQuote(ws!, id);
    expect(q!.termsConditions).toBe("Full payment due on acceptance. 50% deposit non-refundable.");
    expect(q!.sections).toHaveLength(3);
    // Sections come back ordered by position, preserving the input order.
    expect(q!.sections.map((s) => s.title)).toEqual(["Scope", "Optional: Hosting", "Timeline"]);
    expect(q!.sections[0]!.position).toBe(0);
    expect(q!.sections[1]!.position).toBe(1);
    expect(q!.sections[1]!.optional).toBe(true);
    expect(q!.sections[0]!.optional).toBe(false);
    expect(q!.sections[2]!.optional).toBe(false);
  });

  it("replaces sections on update (omit = untouched, [] = clear)", async () => {
    const id = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-02"),
        taxRate: 0,
        lineItems: [{ description: "X", quantity: 1, unitPriceCents: 100 }],
        sections: [{ title: "First", body: "v1" }],
      },
      actor,
    );

    // Update with new sections → replaced.
    await updateQuote(
      ws!,
      id,
      {
        sections: [
          { title: "Replaced A", body: "new" },
          { title: "Replaced B", body: "new" },
        ],
      },
      actor,
    );
    const q = await getQuote(ws!, id);
    expect(q!.sections.map((s) => s.title)).toEqual(["Replaced A", "Replaced B"]);

    // Clear with [].
    await updateQuote(ws!, id, { sections: [] }, actor);
    const cleared = await getQuote(ws!, id);
    expect(cleared!.sections).toEqual([]);
  });

  it("defaults termsConditions to null when none provided", async () => {
    const id = await createQuote(
      ws!,
      {
        issueDate: new Date("2026-07-03"),
        taxRate: 0,
        lineItems: [{ description: "No T&Cs", quantity: 1, unitPriceCents: 100 }],
      },
      actor,
    );
    const q = await getQuote(ws!, id);
    expect(q!.termsConditions).toBeNull();
    expect(q!.sections).toEqual([]);
  });
});
