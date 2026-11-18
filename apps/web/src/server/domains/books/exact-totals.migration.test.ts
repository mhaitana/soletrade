// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";
import { summarizeGstMonthly, type GstMonthlyPoint } from "@/lib/domain/books/calc";

/**
 * The data API returns at most 1,000 rows per request, so totals must be computed in
 * Postgres. These run every repository migration in embedded PostgreSQL and check the two
 * aggregate functions against workspaces that hold more rows than that cap.
 */

let db: PGlite;
const actor = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";
const otherWorkspace = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text);
    insert into auth.users values('11111111-1111-4111-8111-111111110099','admin@soletrade.example');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
  `);
  const directory = path.join(repositoryRoot, "supabase/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  }
  await db.query("insert into users(id,email) values($1,'totals@test.invalid')", [actor]);
  await db.query(
    `insert into workspaces(id,name,slug,owner_user_id) values
       ($1,'Totals','totals',$3), ($2,'Other','totals-other',$3)`,
    [workspace, otherWorkspace, actor],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe.sequential("exact totals on PostgreSQL", () => {
  it("totals GST per month across more rows than the data API returns", async () => {
    // 1,300 transactions over 26 months; every 7th has a negative GST value to prove the
    // function takes magnitudes, as the application code always has.
    await db.query(
      `insert into book_transactions(workspace_id,type,amount_cents,gst_cents,date,description,category)
       select $1,
         (case when i % 3 = 0 then 'expense' else 'income' end)::book_type,
         1100 + i,
         (case when i % 7 = 0 then -1 else 1 end) * (100 + i % 37),
         timestamp '2025-01-05 10:00:00' + make_interval(months => i % 26, days => i % 20),
         'row ' || i,
         'other'
       from generate_series(1, 1300) as i`,
      [workspace],
    );
    // A second workspace must never leak into the first one's totals.
    await db.query(
      `insert into book_transactions(workspace_id,type,amount_cents,gst_cents,date,description,category)
       values ($1,'income',999900,99990,timestamp '2025-03-01','other workspace','other')`,
      [otherWorkspace],
    );

    const { rows } = await db.query<{ months: GstMonthlyPoint[] }>(
      "select public.get_gst_monthly($1) as months",
      [workspace],
    );
    const months = rows[0]!.months;
    expect(months).toHaveLength(26);
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());

    const expected = await db.query<{ collected: string; paid: string; total: string }>(
      `select
         coalesce(sum(abs(gst_cents)) filter (where type = 'income'), 0) as collected,
         coalesce(sum(abs(gst_cents)) filter (where type = 'expense'), 0) as paid,
         count(*) as total
       from book_transactions where workspace_id = $1`,
      [workspace],
    );
    expect(Number(expected.rows[0]!.total)).toBe(1300);

    const summary = summarizeGstMonthly(months, 7);
    expect(summary.gstCollectedCents).toBe(Number(expected.rows[0]!.collected));
    expect(summary.gstPaidCents).toBe(Number(expected.rows[0]!.paid));
    expect(summary.byQuarter.reduce((sum, q) => sum + q.netGstCents, 0)).toBe(summary.netGstCents);
  });

  it("returns an empty list for a workspace with no transactions", async () => {
    const { rows } = await db.query<{ months: GstMonthlyPoint[] }>(
      "select public.get_gst_monthly($1) as months",
      ["44444444-4444-4444-8444-444444444444"],
    );
    expect(rows[0]!.months).toEqual([]);
  });

  it("sums the credit ledger past 1,000 entries, per currency and per workspace", async () => {
    await db.query(
      `insert into credit_ledger(workspace_id,entry_type,amount_cents,currency,reason)
       select $1, 'grant', 250, 'AUD', 'top-up ' || i from generate_series(1, 1200) as i`,
      [workspace],
    );
    await db.query(
      `insert into credit_ledger(workspace_id,entry_type,amount_cents,currency,reason) values
         ($1,'consumption',-1000,'AUD','receipt extraction'),
         ($1,'grant',777,'NZD','other currency'),
         ($2,'grant',999999,'AUD','other workspace')`,
      [workspace, otherWorkspace],
    );

    const aud = await db.query<{ balance: string }>(
      "select public.get_credit_balance($1, 'AUD') as balance",
      [workspace],
    );
    expect(Number(aud.rows[0]!.balance)).toBe(1200 * 250 - 1000);

    const defaulted = await db.query<{ balance: string }>(
      "select public.get_credit_balance($1) as balance",
      [workspace],
    );
    expect(Number(defaulted.rows[0]!.balance)).toBe(1200 * 250 - 1000);

    const nzd = await db.query<{ balance: string }>(
      "select public.get_credit_balance($1, 'NZD') as balance",
      [workspace],
    );
    expect(Number(nzd.rows[0]!.balance)).toBe(777);

    const empty = await db.query<{ balance: string }>(
      "select public.get_credit_balance($1, 'USD') as balance",
      [workspace],
    );
    expect(Number(empty.rows[0]!.balance)).toBe(0);
  });

  it("exposes the functions to the service role only", async () => {
    const { rows } = await db.query<{ role: string; gst: boolean; credit: boolean }>(
      `select r.role,
         has_function_privilege(r.role, 'public.get_gst_monthly(uuid)', 'execute') as gst,
         has_function_privilege(r.role, 'public.get_credit_balance(uuid, text)', 'execute') as credit
       from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
       order by r.role`,
    );
    expect(rows).toEqual([
      { role: "anon", gst: false, credit: false },
      { role: "authenticated", gst: false, credit: false },
      { role: "service_role", gst: true, credit: true },
    ]);
  });

  it("creates the job and assistant indexes", async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)
       order by indexname`,
      [
        [
          "ai_conversations_workspace_user_updated_idx",
          "credit_ledger_expiring_idx",
          "invoices_open_due_idx",
          "mobile_notification_outbox_attention_idx",
          "mobile_operations_processing_idx",
          "mobile_push_delivery_attention_idx",
          "quotes_open_valid_until_idx",
        ],
      ],
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      "ai_conversations_workspace_user_updated_idx",
      "credit_ledger_expiring_idx",
      "invoices_open_due_idx",
      "mobile_notification_outbox_attention_idx",
      "mobile_operations_processing_idx",
      "mobile_push_delivery_attention_idx",
      "quotes_open_valid_until_idx",
    ]);
  });
});
