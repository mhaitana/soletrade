import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  bookTransactions,
  taxPeriods,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace, updateWorkspace } from "@/platform/workspaces";
import { listTaxPeriods, lodgeTaxPeriod } from "@/modules/books/tax";

/**
 * Migration 0022 integration: a workspace's `fyStartMonth` reanchors the GST/BAS quarter
 * date ranges. Verifies that an NZ workspace (fyStartMonth = 4 = 1 April) lodges Q1 as
 * Apr–Jun (capturing a May transaction, excluding an August one that falls in Q2).
 *
 * DB-gated: skips when DATABASE_URL is unset (CI without Postgres).
 * UUID suffix `...0000f2` is unique to this file.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("tax lodgement honours fyStartMonth (migration 0022)", () => {
  const owner = branded<"UserId">("00000000-0000-4000-8000-0000000000f2");
  let ws: WorkspaceId;

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values([
      {
        id: owner,
        email: "tax-fy-owner@soletrade-test.local",
        fullName: "Tax FY Owner",
      },
    ]);
    ws = await createWorkspace(owner, "Tax FY Test", `tax-fy-test-${Date.now()}`);
    // Switch the workspace to an NZ financial year (1 April).
    await updateWorkspace(
      ws,
      {
        name: "Tax FY Test",
        defaultCurrency: "NZD",
        invoicePrefix: "INV-",
        quotePrefix: "QUO-",
        timezone: "Pacific/Auckland",
        fyStartMonth: 4,
      },
      owner,
    );

    // Two income transactions with GST, one per NZ fiscal quarter:
    //   txA: May 2026 → NZ FY2026 Q1 (Apr–Jun).
    //   txB: Aug 2026 → NZ FY2026 Q2 (Jul–Sep).
    await db.insert(bookTransactions).values([
      {
        workspaceId: ws,
        type: "income",
        amountCents: 10000,
        gstCents: 1000,
        currency: "NZD",
        date: new Date("2026-05-15T12:00:00Z"),
        description: "Q1 NZ transaction",
        category: "sales",
      },
      {
        workspaceId: ws,
        type: "income",
        amountCents: 20000,
        gstCents: 2000,
        currency: "NZD",
        date: new Date("2026-08-15T12:00:00Z"),
        description: "Q2 NZ transaction",
        category: "sales",
      },
    ]);
  });

  afterAll(async () => {
    const db = getDb();
    if (!ws) return;
    await db.delete(taxPeriods).where(eq(taxPeriods.workspaceId, ws));
    await db.delete(bookTransactions).where(eq(bookTransactions.workspaceId, ws));
    await db.delete(auditLogs).where(eq(auditLogs.workspaceId, ws));
    // createWorkspace inserts the owner as a workspace_members row; drop it before the workspace.
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner]));
  });

  it("lodges NZ FY2026 Q1 as Apr–Jun (captures May, excludes Aug)", async () => {
    const lodged = await lodgeTaxPeriod(ws!, 2026, 1, owner, 4);
    expect(lodged.periodLabel).toBe("2026-Q1");
    expect(lodged.fiscalYear).toBe(2026);
    expect(lodged.quarter).toBe(1);
    // Only the May (Q1) transaction's GST is collected; the Aug (Q2) one is excluded.
    expect(lodged.gstCollectedCents).toBe(1000);
    expect(lodged.gstPaidCents).toBe(0);
    expect(lodged.netGstCents).toBe(1000);
  });

  it("lodges NZ FY2026 Q2 as Jul–Sep (captures Aug)", async () => {
    const lodged = await lodgeTaxPeriod(ws!, 2026, 2, owner, 4);
    expect(lodged.periodLabel).toBe("2026-Q2");
    expect(lodged.gstCollectedCents).toBe(2000);
    expect(lodged.netGstCents).toBe(2000);
  });

  it("listTaxPeriods returns both lodged quarters sorted by (fiscalYear, quarter)", async () => {
    const rows = await listTaxPeriods(ws!);
    const labels = rows.map((r) => r.periodLabel);
    expect(labels).toEqual(["2026-Q1", "2026-Q2"]);
  });
});
