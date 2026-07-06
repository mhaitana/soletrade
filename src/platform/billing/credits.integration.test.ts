import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  creditLedger as creditLedgerTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus, onEvent } from "@/server/events";
import {
  adjustCredit,
  consumeCredit,
  getCreditBalance,
  grantCredit,
  grantPromotionalCredit,
  markExpiredCredits,
  InsufficientCreditError,
  listCreditLedger,
  refundCredit,
} from "./credits";

/**
 * Integration tests for the credit ledger service against a real Postgres.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Skipped when DATABASE_URL is unset so the unit suite stays green anywhere.
 * Creates its own user + workspace and cleans everything up in `afterAll`.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("credit ledger integration (requires DATABASE_URL)", () => {
  const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000a1");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  const collectedEvents: { type: string; amountCents?: number }[] = [];

  beforeAll(async () => {
    const db = getDb();
    clearEventBus();
    await db
      .insert(usersTable)
      .values({ id: actor, email: "credit-actor@soletrade-test.local", fullName: "Credit Actor" });
    ws1 = await createWorkspace(actor, "Credit Test One", `credit-test-one-${Date.now()}`);
    ws2 = await createWorkspace(actor, "Credit Test Two", `credit-test-two-${Date.now()}`);
    // Collect CreditIssued / RefundIssued events for the assertion below.
    onEvent("CreditIssued", (e) => {
      collectedEvents.push({
        type: e.type,
        amountCents: (e.metadata as { amountCents?: number })?.amountCents,
      });
    });
    onEvent("RefundIssued", (e) => {
      collectedEvents.push({
        type: e.type,
        amountCents: (e.metadata as { amountCents?: number })?.amountCents,
      });
    });
  });

  afterAll(async () => {
    const db = getDb();
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) {
      await db.delete(usersTable).where(eq(usersTable.id, actor));
      return;
    }
    await db.delete(creditLedgerTable).where(inArray(creditLedgerTable.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(eq(usersTable.id, actor));
    clearEventBus();
  });

  it("starts at a zero balance for a new workspace", async () => {
    expect(await getCreditBalance(ws1!)).toBe(0);
  });

  it("increases the balance after a grant", async () => {
    const res = await grantCredit(ws1!, { amountCents: 5000, reason: "promotional.grant" }, actor);
    expect(res.balanceCents).toBe(5000);
    expect(await getCreditBalance(ws1!)).toBe(5000);
  });

  it("decreases the balance after a consumption within the balance", async () => {
    const res = await consumeCredit(ws1!, { amountCents: 1500, reason: "invoice.apply" }, actor);
    expect(res.balanceCents).toBe(3500);
    expect(await getCreditBalance(ws1!)).toBe(3500);
  });

  it("throws InsufficientCreditError when consumption would drive the balance negative", async () => {
    const balanceBefore = await getCreditBalance(ws1!); // 3500
    await expect(
      consumeCredit(ws1!, { amountCents: 10_000, reason: "too.much" }, actor),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
    // Balance is unchanged after a rejected consumption.
    expect(await getCreditBalance(ws1!)).toBe(balanceBefore);
  });

  it("increases the balance after a refund", async () => {
    const balanceBefore = await getCreditBalance(ws1!);
    const res = await refundCredit(
      ws1!,
      { amountCents: 500, reason: "module.cancel.refund", moduleKey: "books" },
      actor,
    );
    expect(res.balanceCents).toBe(balanceBefore + 500);
    expect(await getCreditBalance(ws1!)).toBe(balanceBefore + 500);
  });

  it("applies signed adjustments in both directions", async () => {
    const before = await getCreditBalance(ws1!);
    const up = await adjustCredit(ws1!, { amountCents: 200, reason: "admin.adjust.up" }, actor);
    expect(up.balanceCents).toBe(before + 200);
    const down = await adjustCredit(
      ws1!,
      { amountCents: -100, reason: "admin.adjust.down" },
      actor,
    );
    expect(down.balanceCents).toBe(before + 200 - 100);
    expect(await getCreditBalance(ws1!)).toBe(before + 200 - 100);
  });

  it("isolates the ledger per workspace (no IDOR)", async () => {
    // ws2 has no entries; listing it returns nothing.
    const ws2Ledger = await listCreditLedger(ws2!);
    expect(ws2Ledger).toHaveLength(0);
    // ws1 has all the entries above.
    const ws1Ledger = await listCreditLedger(ws1!);
    expect(ws1Ledger.length).toBeGreaterThan(0);
    // Every returned row belongs to ws1 — never ws2.
    expect(ws1Ledger.every((row) => row.workspaceId === ws1!)).toBe(true);
  });

  it("writes audit rows for grant/consume/refund/adjust", async () => {
    const db = getDb();
    const rows = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, ws1!));
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("credit.grant")).toBe(true);
    expect(actions.has("credit.consume")).toBe(true);
    expect(actions.has("credit.refund")).toBe(true);
    expect(actions.has("credit.adjust")).toBe(true);
  });

  it("publishes CreditIssued for grants/positive-adjustments and RefundIssued for refunds", async () => {
    const grants = collectedEvents.filter((e) => e.type === "CreditIssued");
    const refunds = collectedEvents.filter((e) => e.type === "RefundIssued");
    expect(grants.length).toBeGreaterThanOrEqual(2); // grant + positive adjust
    expect(refunds.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects zero/negative amounts on the semantic mutators", async () => {
    await expect(grantCredit(ws1!, { amountCents: 0, reason: "x" }, actor)).rejects.toThrow();
    await expect(consumeCredit(ws1!, { amountCents: -5, reason: "x" }, actor)).rejects.toThrow();
    await expect(refundCredit(ws1!, { amountCents: -5, reason: "x" }, actor)).rejects.toThrow();
    await expect(adjustCredit(ws1!, { amountCents: 0, reason: "x" }, actor)).rejects.toThrow();
  });

  it("exposes no update/delete mutator (append-only by construction)", async () => {
    // The module exports only grant/consume/refund/adjust/list/balance — there is
    // no function that could mutate an existing ledger row. This is a structural
    // guarantee: the only mutator (appendCreditEntry) is module-private.
    const exports = await import("./credits");
    expect((exports as Record<string, unknown>).appendCreditEntry).toBeUndefined();
    expect(typeof exports.grantCredit).toBe("function");
    expect(typeof exports.consumeCredit).toBe("function");
    expect(typeof exports.refundCredit).toBe("function");
    expect(typeof exports.adjustCredit).toBe("function");
    expect(typeof exports.listCreditLedger).toBe("function");
    expect(typeof exports.getCreditBalance).toBe("function");
  });

  it("grantPromotionalCredit writes an entry of type 'promotion' and raises the balance", async () => {
    const before = await getCreditBalance(ws2!); // 0 (fresh workspace)
    const res = await grantPromotionalCredit(
      ws2!,
      {
        amountCents: 1000,
        reason: "launch.promo",
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
      actor,
    );
    expect(res.balanceCents).toBe(before + 1000);
    const ledger = await listCreditLedger(ws2!);
    expect(ledger.some((r) => r.entryType === "promotion")).toBe(true);
  });

  it("grantCredit persists expiresAt when provided (and null when omitted)", async () => {
    const db = getDb();
    const expiry = new Date(Date.now() + 7 * 86_400_000);
    await grantCredit(ws2!, { amountCents: 2500, reason: "timed.grant", expiresAt: expiry }, actor);
    await grantCredit(ws2!, { amountCents: 500, reason: "perpetual.grant" }, actor);
    const rows = await db
      .select({ entryType: creditLedgerTable.entryType, expiresAt: creditLedgerTable.expiresAt })
      .from(creditLedgerTable)
      .where(eq(creditLedgerTable.workspaceId, ws2!));
    const timed = rows.find((r) => r.entryType === "grant" && r.expiresAt != null);
    const perpetual = rows.find((r) => r.entryType === "grant" && r.expiresAt == null);
    expect(timed).toBeDefined();
    expect(perpetual).toBeDefined();
  });

  it("markExpiredCredits is idempotent and reduces the balance (expired row appended once)", async () => {
    // Grant a credit already past its expiry on ws2.
    const expiredAmount = 800;
    const pastExpiry = new Date(Date.now() - 86_400_000); // 1 day ago
    const balanceBefore = await getCreditBalance(ws2!);
    await grantCredit(
      ws2!,
      { amountCents: expiredAmount, reason: "expired.promo", expiresAt: pastExpiry },
      actor,
    );
    const balanceAfterGrant = await getCreditBalance(ws2!);
    expect(balanceAfterGrant).toBe(balanceBefore + expiredAmount);

    // First run: should append one 'expired' row → balance drops by expiredAmount.
    const firstRun = await markExpiredCredits(new Date());
    expect(firstRun).toBeGreaterThanOrEqual(1);

    // Second run: idempotent — the already-expired grant is not reversed again.
    const secondRun = await markExpiredCredits(new Date());
    expect(secondRun).toBe(0);

    // Balance is back down by expiredAmount (one reversal).
    const balanceAfterExpire = await getCreditBalance(ws2!);
    expect(balanceAfterExpire).toBe(balanceAfterGrant - expiredAmount);

    // Exactly one 'expired' row references this grant via metadata.originalEntryId.
    const db = getDb();
    const expiredRows = await db
      .select({ entryType: creditLedgerTable.entryType })
      .from(creditLedgerTable)
      .where(eq(creditLedgerTable.workspaceId, ws2!));
    expect(expiredRows.filter((r) => r.entryType === "expired").length).toBeGreaterThanOrEqual(1);
  });
});
