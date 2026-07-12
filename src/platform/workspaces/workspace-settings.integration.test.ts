import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/db/client";
import { unwrap } from "@/server/db/helpers";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace, getWorkspace, updateWorkspace } from "@/platform/workspaces";
import { createInvoice, getInvoice } from "@/modules/invoices";

/**
 * Wave 4 Part F integration: migration 0018 wired the workspace's `invoicePrefix` /
 * `quotePrefix` / `timezone` / `defaultCurrency` into the number generators + currency
 * default. Verifies the columns exist + default, `updateWorkspace` persists edits, and a new
 * invoice uses the workspace prefix + currency.
 *
 * DB-gated: skips when DATABASE_URL is unset (CI without Postgres).
 * UUID suffix `...0000f1` is unique to this file.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)(
  "workspace settings + invoice prefix/currency wiring (migration 0018)",
  () => {
    const owner = branded<"UserId">("00000000-0000-4000-8000-0000000000f1");
    let ws: WorkspaceId;

    beforeAll(async () => {
      await seedUsers([
        {
          id: owner,
          email: "ws-settings-owner@soletrade-test.local",
          fullName: "WS Settings Owner",
        },
      ]);
      ws = await createWorkspace(owner, "Settings Test", `settings-test-${Date.now()}`);
    });

    afterAll(async () => {
      if (!ws) return;
      // invoice_line_items + invoices are workspace-scoped; the single created invoice (if
      // any) is covered by these deletes. Order matters: line items before invoices (FK).
      await cleanupWorkspaces(
        [ws],
        [owner],
        [{ table: "invoice_line_items" }, { table: "invoices" }, { table: "audit_logs" }],
      );
    });

    it("workspaces has the migration 0018 columns with defaults", async () => {
      const row = await getWorkspace(ws!);
      expect(row).not.toBeNull();
      expect(row!.defaultCurrency).toBe("AUD");
      expect(row!.invoicePrefix).toBe("INV-");
      expect(row!.quotePrefix).toBe("QUO-");
      expect(row!.timezone).toBe("Australia/Sydney");
      // migration 0022: financial-year start defaults to 7 (1 July, Australian).
      expect(row!.fyStartMonth).toBe(7);
    });

    it("updateWorkspace persists name + currency + prefixes + timezone + fyStartMonth", async () => {
      const updated = await updateWorkspace(
        ws!,
        {
          name: "Settings Test Renamed",
          defaultCurrency: "USD",
          invoicePrefix: "INVOICE-",
          quotePrefix: "QUOTE-",
          timezone: "America/New_York",
          fyStartMonth: 4,
        },
        owner,
      );
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("Settings Test Renamed");
      expect(updated!.defaultCurrency).toBe("USD");
      expect(updated!.invoicePrefix).toBe("INVOICE-");
      expect(updated!.quotePrefix).toBe("QUOTE-");
      expect(updated!.timezone).toBe("America/New_York");
      expect(updated!.fyStartMonth).toBe(4);
      // Re-read to confirm persistence.
      const reread = await getWorkspace(ws!);
      expect(reread!.invoicePrefix).toBe("INVOICE-");
      expect(reread!.defaultCurrency).toBe("USD");
      expect(reread!.fyStartMonth).toBe(4);
    });

    it("createInvoice uses the workspace invoice prefix + default currency", async () => {
      const year = new Date().getFullYear();
      const invId = await createInvoice(
        ws!,
        {
          issueDate: new Date(`${year}-01-15`),
          taxRate: 0,
          lineItems: [{ description: "Prefix wiring test", quantity: 1, unitPriceCents: 5000 }],
        },
        owner,
      );

      // createInvoice returns the InvoiceId only; read the row back to assert the stored
      // number + currency (the workspace prefix + default currency, not the hardcoded ones).
      const reread = await getInvoice(ws!, invId);
      expect(reread).not.toBeNull();
      expect(reread!.number).toBe(`INVOICE-${year}-0001`);
      expect(reread!.currency).toBe("USD"); // workspace default, not hardcoded AUD
    });

    it("workspace_settings table is gone (migration 0018 dropped it)", async () => {
      // After dropping the table + removing the schema export, a PostgREST read against
      // the old table name errors (PGRST205 - table not found in schema cache). unwrap
      // surfaces the error, which carries the table name.
      await expect(
        unwrap(
          getDataClient()
            .from("workspace_settings" as never)
            .select("*")
            .limit(1),
        ),
      ).rejects.toThrow(/workspace_settings|does not exist/i);
    });
  },
);
