// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
let db: PGlite;
const user = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const quote = "33333333-3333-4333-8333-333333333333";
const first = "44444444-4444-4444-8444-444444444444";
const second = "55555555-5555-4555-8555-555555555555";
const legacy = {
  user: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  workspace: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  quote: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  invoice: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
};
beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text);
    insert into auth.users values('11111111-1111-4111-8111-111111110099','admin@soletrade.example');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const directory = path.join(process.cwd(), "supabase/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (file.endsWith("_atomic_quote_conversion.sql")) {
      // Existing successful conversions predate the provenance column.
      await db.exec(`insert into users(id,email) values('${legacy.user}','legacy@test.invalid');
        insert into workspaces(id,name,slug,owner_user_id) values('${legacy.workspace}','Legacy','legacy-conversion','${legacy.user}');
        insert into workspace_members(workspace_id,user_id,role) values('${legacy.workspace}','${legacy.user}','owner');
        insert into module_installations(workspace_id,module_key) values('${legacy.workspace}','quotes'),('${legacy.workspace}','invoices');
        insert into invoices(id,workspace_id,number) values('${legacy.invoice}','${legacy.workspace}','INV-OLD');
        insert into quotes(id,workspace_id,number,status,converted_invoice_id) values('${legacy.quote}','${legacy.workspace}','QUO-OLD','converted','${legacy.invoice}');`);
    }
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  }
  await db.exec(`insert into users(id,email) values('${user}','convert@test.invalid');
    insert into workspaces(id,name,slug,owner_user_id,invoice_prefix,payment_methods) values('${workspace}','Convert','convert','${user}','CUSTOM-','[{"type":"cash"}]');
    insert into workspace_members(workspace_id,user_id,role) values('${workspace}','${user}','owner');
    insert into module_installations(workspace_id,module_key) values('${workspace}','quotes'),('${workspace}','invoices');
    insert into quotes(id,workspace_id,number,status,currency,tax_rate,prices_include_tax,subtotal_cents,tax_cents,total_cents) values('${quote}','${workspace}','QUO-2026-0001','accepted','AUD',10,true,2275,228,2503);
    insert into quote_line_items(quote_id,workspace_id,description,quantity,unit_price_cents,amount_cents,position) values('${quote}','${workspace}','Consulting',2.5,1001,2503,0);`);
}, 60_000);
afterAll(async () => {
  await db?.close();
});
async function convert(proposed = first, target = quote, expected: string | null = null) {
  const result = await db.query<{ result: { invoiceId: string; created: boolean } }>(
    "select convert_quote_to_invoice($1,$2,$3,$4,$5,2026) as result",
    [workspace, target, user, proposed, expected],
  );
  return result.rows[0]!.result;
}
describe.sequential("atomic quote conversion on PostgreSQL", () => {
  it("backfills successful legacy conversion provenance without creating another invoice", async () => {
    expect(
      (await db.query("select source_quote_id from invoices where id=$1", [legacy.invoice]))
        .rows[0],
    ).toEqual({ source_quote_id: legacy.quote });
    const { rows } = await db.query(
      "select convert_quote_to_invoice($1,$2,$3,$4,null,2026) as result",
      [legacy.workspace, legacy.quote, legacy.user, second],
    );
    expect(rows[0]).toEqual({ result: { invoiceId: legacy.invoice, created: false } });
    expect(
      (await db.query("select id from invoices where workspace_id=$1", [legacy.workspace])).rows,
    ).toHaveLength(1);
  });
  it("returns the original invoice after a lost response, another operation or device", async () => {
    const original = await convert(); // Caller may lose this response after COMMIT.
    expect(original).toEqual({ invoiceId: first, created: true });
    expect(await convert()).toEqual({ invoiceId: first, created: false });
    expect(await convert(second)).toEqual({ invoiceId: first, created: false });
    const invoices = await db.query("select * from invoices where workspace_id=$1", [workspace]);
    expect(invoices.rows).toHaveLength(1);
    expect(invoices.rows[0]).toMatchObject({
      id: first,
      source_quote_id: quote,
      number: "CUSTOM-2026-0001",
      status: "draft",
      due_date: null,
      currency: "AUD",
      prices_include_tax: true,
      subtotal_cents: 2275,
      tax_cents: 228,
      total_cents: 2503,
      payment_methods: null,
      notes: "Converted from quote QUO-2026-0001.",
    });
    expect(
      (await db.query("select * from invoice_line_items where invoice_id=$1", [first])).rows,
    ).toMatchObject([
      {
        description: "Consulting",
        quantity: "2.50",
        unit_price_cents: 1001,
        amount_cents: 2503,
        position: 0,
      },
    ]);
    expect(
      (await db.query("select status,converted_invoice_id from quotes where id=$1", [quote]))
        .rows[0],
    ).toEqual({ status: "converted", converted_invoice_id: first });
    expect(
      (
        await db.query(
          "select id from audit_logs where workspace_id=$1 and action in ('invoice.create','quote.convert')",
          [workspace],
        )
      ).rows,
    ).toHaveLength(2);
    expect(
      (
        await db.query(
          "select id from activity_events where workspace_id=$1 and type in ('InvoiceCreated','QuoteConvertedToInvoice')",
          [workspace],
        )
      ).rows,
    ).toHaveLength(2);
  });
  it("rolls back the invoice, lines and history if the quote transition fails", async () => {
    const failingQuote = "66666666-6666-4666-8666-666666666666";
    await db.query(
      "insert into quotes(id,workspace_id,number,status,subtotal_cents,total_cents) values($1,$2,'QUO-FAIL','accepted',100,100)",
      [failingQuote, workspace],
    );
    await db.query(
      "insert into quote_line_items(quote_id,workspace_id,description,quantity,unit_price_cents,amount_cents,position) values($1,$2,'Test',1,100,100,0)",
      [failingQuote, workspace],
    );
    await db.exec(`create function fail_conversion_test() returns trigger language plpgsql as $$ begin if new.number='QUO-FAIL' and new.status='converted' then raise exception 'Injected transition failure'; end if; return new; end $$;
      create trigger fail_conversion_test before update on quotes for each row execute function fail_conversion_test();`);
    await expect(convert(second, failingQuote)).rejects.toThrow(/Injected transition failure/);
    expect((await db.query("select id from invoices where id=$1", [second])).rows).toHaveLength(0);
    expect(
      (await db.query("select id from invoice_line_items where invoice_id=$1", [second])).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select status from quotes where id=$1", [failingQuote])).rows[0],
    ).toEqual({ status: "accepted" });
    expect(
      (await db.query("select id from audit_logs where target_id=$1", [second])).rows,
    ).toHaveLength(0);
    await db.exec(
      "drop trigger fail_conversion_test on quotes; drop function fail_conversion_test()",
    );
  });
  it("rejects foreign workspaces, unavailable modules and invalid quote states without an invoice", async () => {
    await expect(
      db.query("select convert_quote_to_invoice(gen_random_uuid(),$1,$2,$3,null,2026)", [
        quote,
        user,
        second,
      ]),
    ).rejects.toThrow();
    await db.exec("begin");
    try {
      await db.query(
        "update module_installations set status='cancelled' where workspace_id=$1 and module_key='invoices'",
        [workspace],
      );
      await expect(convert(second)).rejects.toThrow(/module/i);
    } finally {
      await db.exec("rollback");
    }
    const draft = "77777777-7777-4777-8777-777777777777";
    await db.query("insert into quotes(id,workspace_id,number) values($1,$2,'QUO-DRAFT')", [
      draft,
      workspace,
    ]);
    await expect(convert(second, draft)).rejects.toThrow(/accepted/);
    expect((await db.query("select id from invoices where id=$1", [second])).rows).toHaveLength(0);
  });
  it("revalidates current membership instead of trusting a previously signed role", async () => {
    await db.exec("begin");
    try {
      await db.query(
        "update workspace_members set role='employee' where workspace_id=$1 and user_id=$2",
        [workspace, user],
      );
      await expect(convert(second)).rejects.toThrow(/role/);
    } finally {
      await db.exec("rollback");
    }
  });
  it("checks the supplied version atomically for a new conversion", async () => {
    const stale = "88888888-8888-4888-8888-888888888888";
    await db.query(
      "insert into quotes(id,workspace_id,number,status) values($1,$2,'QUO-STALE','accepted')",
      [stale, workspace],
    );
    await expect(convert(second, stale, "2000-01-01T00:00:00Z")).rejects.toThrow(
      /changed|version/i,
    );
    expect((await db.query("select id from invoices where id=$1", [second])).rows).toHaveLength(0);
  });
  it("handles number holes/collisions and rolls back number allocation on failure", async () => {
    const nextQuote = "99999999-9999-4999-8999-999999999999";
    await db.exec("begin");
    try {
      // Count+1 picks 0003 here, so the existing 0003 must be skipped safely.
      await db.query("insert into invoices(workspace_id,number) values($1,'CUSTOM-2026-0003')", [
        workspace,
      ]);
      await db.query(
        "insert into quotes(id,workspace_id,number,status,subtotal_cents,total_cents) values($1,$2,'QUO-NEXT','accepted',100,100)",
        [nextQuote, workspace],
      );
      await db.query(
        "insert into quote_line_items(quote_id,workspace_id,description,quantity,unit_price_cents,amount_cents,position) values($1,$2,'Test',1,100,100,0)",
        [nextQuote, workspace],
      );
      expect(await convert(second, nextQuote)).toEqual({ invoiceId: second, created: true });
      expect((await db.query("select number from invoices where id=$1", [second])).rows[0]).toEqual(
        { number: "CUSTOM-2026-0004" },
      );
      expect(await convert(first, nextQuote)).toEqual({ invoiceId: second, created: false });
    } finally {
      await db.exec("rollback");
    }
    // Earlier injected failure did not leave an invoice or consume 0002.
    expect(await convert(second, "66666666-6666-4666-8666-666666666666")).toEqual({
      invoiceId: second,
      created: true,
    });
    expect((await db.query("select number from invoices where id=$1", [second])).rows[0]).toEqual({
      number: "CUSTOM-2026-0002",
    });
  });
  it("exposes the conversion function only to the server role", async () => {
    const { rows } = await db.query(
      "select has_function_privilege('authenticated','convert_quote_to_invoice(uuid,uuid,uuid,uuid,timestamptz,int)','execute') as native, has_function_privilege('service_role','convert_quote_to_invoice(uuid,uuid,uuid,uuid,timestamptz,int)','execute') as server",
    );
    expect(rows[0]).toEqual({ native: false, server: true });
  });
});
