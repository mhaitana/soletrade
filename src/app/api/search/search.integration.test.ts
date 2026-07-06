import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  bookTransactions,
  customers as customersTable,
  invoices as invoicesTable,
  moduleInstallations,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type CustomerId, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createCustomer } from "@/platform/customers";
import { createInvoice } from "@/modules/invoices";
import { createTransaction } from "@/modules/books";
import { searchWorkspace } from "./search";

/**
 * Integration tests for the global search composition root against a real Postgres (trigram
 * indexes from migration 0017 back the ILIKE). Run only when DATABASE_URL is set; otherwise
 * the file skips so `pnpm test:ci` stays green without a DB.
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * Verifies: real rows are tagged + grouped in canonical order; the `getInstalledModules` gate
 * drops a module's group when that module isn't installed (even if rows exist); cross-workspace
 * rows don't leak (the list functions are workspace-scoped → IDOR-safe at the source).
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("searchWorkspace integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-4000-8000-000000000b01");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-000000000b02");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  let ws1Customer: CustomerId;
  let ws2Customer: CustomerId;

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values([
      { id: actor, email: "search-actor@soletrade-test.local", fullName: "Search Actor" },
      { id: otherActor, email: "search-other@soletrade-test.local", fullName: "Search Other" },
    ]);
    ws1 = await createWorkspace(actor, "Search Test One", `search-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Search Test Two", `search-test-two-${Date.now()}`);

    // ws1: install ONLY `books` (not invoices/quotes/drive). Used to prove the module gate —
    // we'll create an invoice in ws1 anyway and confirm it doesn't surface without the module.
    await db
      .insert(moduleInstallations)
      .values([{ workspaceId: ws1, moduleKey: "books", status: "active" }]);
    // ws2: install `invoices` + `books`. Used for the invoice-number search + IDOR cross-check.
    await db.insert(moduleInstallations).values([
      { workspaceId: ws2, moduleKey: "invoices", status: "active" },
      { workspaceId: ws2, moduleKey: "books", status: "active" },
    ]);

    // ws1: a customer + a books tx sharing a unique searchable term, plus an invoice (which
    // should NOT surface because `invoices` isn't installed for ws1).
    ws1Customer = await createCustomer(
      ws1,
      { name: "Ziggy Stardust", email: "ziggy@soletrade-test.local" },
      actor,
    );
    await createInvoice(
      ws1,
      {
        customerId: ws1Customer,
        issueDate: new Date("2026-01-15"),
        taxRate: 10,
        lineItems: [{ description: "Ziggy gig", quantity: 1, unitPriceCents: 10000 }],
      },
      actor,
    );
    await createTransaction(
      ws1,
      {
        type: "income",
        amountCents: 10000,
        date: new Date("2026-01-20"),
        description: "Ziggy consulting fee",
        category: "services",
        customerId: ws1Customer,
      },
      actor,
    );

    // ws2: a customer with a distinct name for the IDOR cross-check.
    ws2Customer = await createCustomer(
      ws2,
      { name: "Ozzy Osbourne", email: "ozzy@soletrade-test.local" },
      otherActor,
    );
  });

  afterAll(async () => {
    const db = getDb();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length === 0) return;
    await db.delete(invoicesTable).where(inArray(invoicesTable.workspaceId, workspaceIds));
    await db.delete(bookTransactions).where(inArray(bookTransactions.workspaceId, workspaceIds));
    await db.delete(customersTable).where(inArray(customersTable.workspaceId, workspaceIds));
    await db
      .delete(moduleInstallations)
      .where(inArray(moduleInstallations.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
    await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
    await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    await db.delete(usersTable).where(inArray(usersTable.id, [actor, otherActor]));
  });

  it("returns customers + books groups in canonical order (customers first)", async () => {
    const groups = await searchWorkspace(ws1!, "ziggy");
    expect(groups.map((g) => g.module)).toEqual(["customers", "books"]);
    const cust = groups.find((g) => g.module === "customers")!.results[0]!;
    expect(cust.label).toBe("Ziggy Stardust");
    expect(cust.href).toBe(`/customers/${ws1Customer}`);
    const tx = groups.find((g) => g.module === "books")!.results[0]!;
    expect(tx.label).toBe("Ziggy consulting fee");
  });

  it("module gate: an invoice exists in ws1 but its number doesn't surface (invoices not installed)", async () => {
    // ws1's first invoice is numbered INV-YYYY-0001 and exists in the DB, but `invoices` isn't
    // installed for ws1 → searchWorkspace never calls listInvoices → no invoices group. The
    // companion ws2 test below confirms the same number DOES surface when invoices is installed.
    const groups = await searchWorkspace(ws1!, "0001");
    expect(groups.find((g) => g.module === "invoices")).toBeUndefined();
  });

  it("returns the invoices group when invoices is installed (search by number)", async () => {
    // ws2 has invoices installed. Create an invoice and search for its number fragment.
    const invId = await createInvoice(
      ws2!,
      {
        customerId: ws2Customer,
        issueDate: new Date("2026-03-01"),
        taxRate: 10,
        lineItems: [{ description: "Ozzy show", quantity: 1, unitPriceCents: 5000 }],
      },
      otherActor,
    );
    // The number is INV-YYYY-0001 for the first ws2 invoice — search the distinctive "0001".
    const groups = await searchWorkspace(ws2!, "0001");
    const invGroup = groups.find((g) => g.module === "invoices");
    expect(invGroup).toBeDefined();
    expect(invGroup!.results[0]!.href).toBe(`/invoices/${invId}`);
  });

  it("isolates results per workspace (no IDOR): ws1 can't see ws2's customer", async () => {
    // "ozzy" only exists in ws2; searching ws1 returns nothing for it.
    const groups = await searchWorkspace(ws1!, "ozzy");
    const cust = groups.find((g) => g.module === "customers")?.results ?? [];
    expect(cust.find((r) => r.label === "Ozzy Osbourne")).toBeUndefined();
    // And ws2 searching "ziggy" (only in ws1) finds no customers.
    const ws2groups = await searchWorkspace(ws2!, "ziggy");
    expect(ws2groups.find((g) => g.module === "customers")?.results ?? []).toEqual([]);
  });

  it("guards queries shorter than 2 chars (no 1-char seq scans)", async () => {
    expect(await searchWorkspace(ws1!, "z")).toEqual([]);
  });
});
