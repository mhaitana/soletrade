import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import {
  branded,
  type BookTransactionId,
  type CustomerId,
  type WorkspaceId,
} from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createCustomer } from "@/platform/customers";
import { onEvent } from "@/server/events";
import {
  createTransaction,
  deleteTransaction,
  findTransactionIdBySource,
  getBookSummary,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "./index";

/**
 * Integration tests for the books service against a real Postgres. Run only when
 * DATABASE_URL is set; skipped otherwise (keeps `pnpm test:ci` green without a DB).
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("books integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-7000-8000-0000000000a1");
  const otherActor = branded<"UserId">("00000000-0000-7000-8000-0000000000a2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  let ws1Customer: CustomerId;
  const createdTxIds: BookTransactionId[] = [];

  const captured: { type: string; transactionId?: string; metadata?: Record<string, unknown> }[] =
    [];
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "books-actor@soletrade-test.local", fullName: "Books Actor" },
      { id: otherActor, email: "books-other@soletrade-test.local", fullName: "Books Other" },
    ]);
    ws1 = await createWorkspace(actor, "Books Test One", `books-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Books Test Two", `books-test-two-${Date.now()}`);
    ws1Customer = await createCustomer(
      ws1,
      { name: "Initech Pty Ltd", email: "initech@soletrade-test.local" },
      actor,
    );

    const u1 = onEvent("TransactionCreated", (e) => {
      captured.push({
        type: "TransactionCreated",
        transactionId: e.entityId,
        metadata: e.metadata as Record<string, unknown> | undefined,
      });
    });
    const u2 = onEvent("TransactionUpdated", (e) => {
      captured.push({ type: "TransactionUpdated", transactionId: e.entityId });
    });
    const u3 = onEvent("TransactionDeleted", (e) => {
      captured.push({ type: "TransactionDeleted", transactionId: e.entityId });
    });
    unsub = () => {
      u1();
      u2();
      u3();
    };
  });

  afterAll(async () => {
    unsub?.();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(
      workspaceIds,
      [actor, otherActor],
      [{ table: "book_transactions" }, { table: "customers" }, { table: "audit_logs" }],
    );
  });

  it("creates an income transaction with the stored fields", async () => {
    const id = await createTransaction(
      ws1!,
      {
        type: "income",
        amountCents: 12000,
        date: new Date("2026-01-15"),
        description: "Consulting - January",
        category: "services",
        customerId: ws1Customer,
      },
      actor,
    );
    createdTxIds.push(id);

    const tx = await getTransaction(ws1!, id);
    expect(tx).not.toBeNull();
    expect(tx!.type).toBe("income");
    expect(tx!.amountCents).toBe(12000);
    expect(tx!.currency).toBe("AUD");
    expect(tx!.description).toBe("Consulting - January");
    expect(tx!.category).toBe("services");
    expect(tx!.customerId).toBe(ws1Customer);
    expect(tx!.customerName).toBe("Initech Pty Ltd");

    const evt = captured.find((e) => e.type === "TransactionCreated" && e.transactionId === id);
    expect(evt).toBeDefined();
    expect(evt?.metadata).toMatchObject({
      type: "income",
      amountCents: 12000,
      category: "services",
    });
  });

  it("creates an expense transaction with no customer", async () => {
    const id = await createTransaction(
      ws1!,
      {
        type: "expense",
        amountCents: 4500,
        date: new Date("2026-01-20"),
        description: "Office supplies",
        category: "supplies",
      },
      actor,
    );
    createdTxIds.push(id);

    const tx = await getTransaction(ws1!, id);
    expect(tx!.type).toBe("expense");
    expect(tx!.customerId).toBeNull();
    expect(tx!.customerName).toBeNull();
  });

  it("isolates transactions per workspace (no IDOR)", async () => {
    // ws2 cannot see ws1's transaction via getTransaction…
    const cross = await getTransaction(ws2!, createdTxIds[0]!);
    expect(cross).toBeNull();

    // …and listTransactions only returns the workspace's own rows.
    const ws1List = await listTransactions(ws1!);
    const ws2List = await listTransactions(ws2!);
    expect(ws1List.some((t) => t.id === createdTxIds[0])).toBe(true);
    expect(ws2List.some((t) => t.id === createdTxIds[0])).toBe(false);
  });

  it("rejects a category that doesn't match the transaction type", async () => {
    await expect(
      createTransaction(
        ws1!,
        {
          type: "income",
          amountCents: 1000,
          date: new Date("2026-02-01"),
          description: "Bad category",
          category: "rent", // rent is an expense category, not income
        },
        actor,
      ),
    ).rejects.toThrow(/Unknown category/i);
  });

  it("rejects a non-positive amount", async () => {
    await expect(
      createTransaction(
        ws1!,
        {
          type: "income",
          amountCents: 0,
          date: new Date("2026-02-02"),
          description: "Zero amount",
          category: "sales",
        },
        actor,
      ),
    ).rejects.toThrow(/greater than 0/i);
  });

  it("rejects assigning a customer from another workspace", async () => {
    await expect(
      createTransaction(
        ws2!,
        {
          type: "income",
          amountCents: 5000,
          date: new Date("2026-02-03"),
          description: "Cross-customer",
          category: "sales",
          customerId: ws1Customer, // belongs to ws1
        },
        otherActor,
      ),
    ).rejects.toThrow(/not found in this workspace/i);
  });

  it("updates a transaction's amount + description and fires TransactionUpdated", async () => {
    const before = captured.filter((e) => e.type === "TransactionUpdated").length;
    await updateTransaction(
      ws1!,
      createdTxIds[0]!,
      { amountCents: 15000, description: "Consulting - January (revised)" },
      actor,
    );
    const tx = await getTransaction(ws1!, createdTxIds[0]!);
    expect(tx!.amountCents).toBe(15000);
    expect(tx!.description).toBe("Consulting - January (revised)");
    const after = captured.filter((e) => e.type === "TransactionUpdated").length;
    expect(after).toBe(before + 1);
  });

  it("updateTransaction on another workspace's row throws (not found)", async () => {
    await expect(
      updateTransaction(ws2!, createdTxIds[0]!, { amountCents: 9999 }, otherActor),
    ).rejects.toThrow(/not found/i);
    // ws1 row is unchanged
    const tx = await getTransaction(ws1!, createdTxIds[0]!);
    expect(tx!.amountCents).toBe(15000);
  });

  it("requires a category when changing transaction type", async () => {
    await expect(
      updateTransaction(ws1!, createdTxIds[0]!, { type: "expense" }, actor),
    ).rejects.toThrow(/Category is required/i);
  });

  it("filters transactions by type and search", async () => {
    const income = await listTransactions(ws1!, { type: "income" });
    expect(income.every((t) => t.type === "income")).toBe(true);
    expect(income.some((t) => t.id === createdTxIds[0])).toBe(true);

    const expense = await listTransactions(ws1!, { type: "expense" });
    expect(expense.every((t) => t.type === "expense")).toBe(true);
    expect(expense.some((t) => t.id === createdTxIds[1])).toBe(true);

    const byDescription = await listTransactions(ws1!, { search: "Consulting" });
    expect(byDescription.length).toBeGreaterThan(0);
    expect(byDescription.some((t) => t.id === createdTxIds[0])).toBe(true);
  });

  it("filters transactions by inclusive date range", async () => {
    // Seed two transactions with distinct, known dates.
    const febId = await createTransaction(
      ws1!,
      {
        type: "income",
        amountCents: 2000,
        date: new Date("2026-02-15T12:00:00Z"),
        description: "Range - Feb",
        category: "sales",
      },
      actor,
    );
    createdTxIds.push(febId);
    const aprId = await createTransaction(
      ws1!,
      {
        type: "income",
        amountCents: 3000,
        date: new Date("2026-04-15T12:00:00Z"),
        description: "Range - Apr",
        category: "sales",
      },
      actor,
    );
    createdTxIds.push(aprId);

    const fromMarch = await listTransactions(ws1!, {
      dateFrom: new Date("2026-03-01T00:00:00Z"),
      limit: 2000,
    });
    // The Feb transaction is excluded; the Apr one is included.
    expect(fromMarch.some((t) => t.id === febId)).toBe(false);
    expect(fromMarch.some((t) => t.id === aprId)).toBe(true);

    // Inclusive upper bound: up to end of Feb excludes the Apr row but includes Feb.
    const toEndOfFeb = await listTransactions(ws1!, {
      dateTo: new Date("2026-02-28T23:59:59Z"),
      limit: 2000,
    });
    expect(toEndOfFeb.some((t) => t.id === aprId)).toBe(false);
    expect(toEndOfFeb.some((t) => t.id === febId)).toBe(true);

    // Both bounds: a tight March–April window.
    const window = await listTransactions(ws1!, {
      dateFrom: new Date("2026-03-01T00:00:00Z"),
      dateTo: new Date("2026-04-30T23:59:59Z"),
      limit: 2000,
    });
    expect(window.some((t) => t.id === febId)).toBe(false);
    expect(window.some((t) => t.id === aprId)).toBe(true);
  });

  it("aggregates the complete filtered set in Postgres", async () => {
    const dateFrom = new Date("2026-02-01T00:00:00Z");
    const rows = await listTransactions(ws1!, { type: "income", dateFrom, limit: 2000 });
    const summary = await getBookSummary(ws1!, { type: "income", dateFrom });

    expect(summary.count).toBe(rows.length);
    expect(summary.incomeCents).toBe(rows.reduce((sum, row) => sum + Math.abs(row.amountCents), 0));
    expect(summary.expenseCents).toBe(0);
    expect(summary.monthly.map((point) => point.month)).toEqual(
      [...new Set(rows.map((row) => row.date.toISOString().slice(0, 7)))].sort(),
    );
  });

  it("deletes a transaction and fires TransactionDeleted", async () => {
    const id = await createTransaction(
      ws1!,
      {
        type: "expense",
        amountCents: 1000,
        date: new Date("2026-03-01"),
        description: "To delete",
        category: "other_expense",
      },
      actor,
    );
    const ok = await deleteTransaction(ws1!, id, actor);
    expect(ok).toBe(true);
    expect(await getTransaction(ws1!, id)).toBeNull();
    expect(captured.some((e) => e.type === "TransactionDeleted" && e.transactionId === id)).toBe(
      true,
    );

    // Deleting from another workspace returns false (not found there).
    const refused = await deleteTransaction(ws2!, createdTxIds[0]!, otherActor);
    expect(refused).toBe(false);
  });

  it("persists receiptFileId and fires ReceiptUploaded on create-with-receipt", async () => {
    const receiptFileId = branded<"FileId">("00000000-0000-4000-8000-0000000000e3");
    let seen = false;
    const off = onEvent("ReceiptUploaded", (e) => {
      if (e.workspaceId === ws1 && e.entityId === receiptFileId) seen = true;
    });
    try {
      const id = await createTransaction(
        ws1!,
        {
          type: "expense",
          amountCents: 2500,
          date: new Date("2026-03-05"),
          description: "Lunch with client",
          category: "other_expense",
          receiptFileId,
        },
        actor,
      );
      createdTxIds.push(id);

      const tx = await getTransaction(ws1!, id);
      expect(tx!.receiptFileId).toBe(receiptFileId);
      expect(seen).toBe(true);

      // Update can clear the receipt link (null patch).
      await updateTransaction(ws1!, id, { receiptFileId: null }, actor);
      const cleared = await getTransaction(ws1!, id);
      expect(cleared!.receiptFileId).toBeNull();
    } finally {
      off();
    }
  });

  // ───────────────── Wave 5: findTransactionIdBySource ─────────────────

  it("findTransactionIdBySource locates a row by its source link (and is workspace-isolated)", async () => {
    const earningId = branded<"DriveEarningId">("00000000-0000-9000-8000-0000000000f1");
    const id = await createTransaction(
      ws1!,
      {
        type: "income",
        amountCents: 15000,
        date: new Date("2026-07-01"),
        description: "Drive earnings · Uber",
        category: "gig",
        sourceEarningId: earningId,
      },
      actor,
    );
    createdTxIds.push(id);

    expect(await findTransactionIdBySource(ws1!, { sourceEarningId: earningId })).toBe(id);
    // Wrong source id → null.
    const otherEarning = branded<"DriveEarningId">("00000000-0000-9000-8000-0000000000f2");
    expect(await findTransactionIdBySource(ws1!, { sourceEarningId: otherEarning })).toBeNull();
    // Workspace isolation - the earning looks absent from ws2.
    expect(await findTransactionIdBySource(ws2!, { sourceEarningId: earningId })).toBeNull();
    // No source keys supplied → null.
    expect(await findTransactionIdBySource(ws1!, {})).toBeNull();

    await expect(updateTransaction(ws1!, id, { amountCents: 99000 }, actor)).rejects.toThrow(
      "Drive",
    );
    await expect(deleteTransaction(ws1!, id, actor)).rejects.toThrow("Drive");
    expect((await getTransaction(ws1!, id))!.amountCents).toBe(15000);
  });
});
