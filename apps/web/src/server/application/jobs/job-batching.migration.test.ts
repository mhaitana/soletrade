// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";

/**
 * The scheduled-job helpers run every repository migration in embedded PostgreSQL:
 * credit expiry must return only grants that are due and not yet reversed, and pruning
 * must remove only completed mobile records older than the cut-off, a batch at a time.
 */

let db: PGlite;
const actor = "11111111-1111-4111-8111-1111111111a1";
const workspace = "22222222-2222-4222-8222-2222222222a2";
const otherWorkspace = "33333333-3333-4333-8333-3333333333a3";

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
  await db.query("insert into users(id,email) values($1,'jobs@test.invalid')", [actor]);
  await db.query(
    `insert into workspaces(id,name,slug,owner_user_id) values
       ($1,'Jobs','jobs',$3), ($2,'Other','jobs-other',$3)`,
    [workspace, otherWorkspace, actor],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type DueRow = { id: string; workspace_id: string; entry_type: string; amount_cents: number };

async function due(now: string, limit?: number): Promise<DueRow[]> {
  const { rows } = await db.query<{ due: DueRow[] }>(
    limit === undefined
      ? "select public.list_due_credit_expiries($1::timestamp) as due"
      : "select public.list_due_credit_expiries($1::timestamp, $2) as due",
    limit === undefined ? [now] : [now, limit],
  );
  return rows[0]!.due;
}

describe.sequential("scheduled-job helpers on PostgreSQL", () => {
  it("lists only grants and promotions that are due and not yet reversed", async () => {
    const { rows } = await db.query<{ id: string; reason: string }>(
      `insert into credit_ledger(workspace_id,entry_type,amount_cents,currency,reason,expires_at) values
         ($1,'grant',500,'AUD','due grant','2026-01-01'),
         ($1,'promotion',300,'AUD','due promotion','2026-02-01'),
         ($1,'grant',700,'AUD','already reversed','2025-06-01'),
         ($1,'grant',900,'AUD','not due yet','2027-01-01'),
         ($1,'grant',100,'AUD','never expires',null),
         ($1,'consumption',-200,'AUD','not a grant','2026-01-01'),
         ($2,'grant',400,'AUD','other workspace due','2026-03-01')
       returning id, reason`,
      [workspace, otherWorkspace],
    );
    const id = (reason: string) => rows.find((r) => r.reason === reason)!.id;
    await db.query(
      `insert into credit_ledger(workspace_id,entry_type,amount_cents,currency,reason,metadata)
       values ($1,'expired',-700,'AUD','credit.expired',jsonb_build_object('originalEntryId',$2::text))`,
      [workspace, id("already reversed")],
    );

    const list = await due("2026-11-18T00:00:00");
    // Oldest expiry first; the reversed, future, open-ended and non-grant rows are absent.
    expect(list.map((r) => r.id)).toEqual([
      id("due grant"),
      id("due promotion"),
      id("other workspace due"),
    ]);
    expect(list[0]).toMatchObject({
      workspace_id: workspace,
      entry_type: "grant",
      amount_cents: 500,
    });

    // Once a reversal is recorded the grant drops out of the next run.
    await db.query(
      `insert into credit_ledger(workspace_id,entry_type,amount_cents,currency,reason,metadata)
       values ($1,'expired',-500,'AUD','credit.expired',jsonb_build_object('originalEntryId',$2::text))`,
      [workspace, id("due grant")],
    );
    expect((await due("2026-11-18T00:00:00")).map((r) => r.id)).toEqual([
      id("due promotion"),
      id("other workspace due"),
    ]);
    expect(await due("2026-11-18T00:00:00", 1)).toHaveLength(1);
    expect(await due("2020-01-01T00:00:00")).toEqual([]);
  });

  it("prunes only completed mobile records older than the cut-off, in batches", async () => {
    await db.query(
      `insert into mobile_api_operations(id,user_id,workspace_id,operation,fingerprint,status,created_at)
       select gen_random_uuid(), $1, $2, 'POST /books', 'fp-' || i,
         case when i % 5 = 0 then 'processing' else 'complete' end,
         timestamptz '2026-01-01' + make_interval(days => i)
       from generate_series(1, 30) as i`,
      [actor, workspace],
    );
    // Before 2026-01-21: rows 1-19 are older; 3 of them (5, 10, 15) are still processing.
    const prune = async (limit: number) =>
      (
        await db.query<{ deleted: number }>(
          "select public.prune_mobile_operations('2026-01-21', $1) as deleted",
          [limit],
        )
      ).rows[0]!.deleted;
    expect(await prune(10)).toBe(10);
    expect(await prune(10)).toBe(6);
    expect(await prune(10)).toBe(0);

    const { rows } = await db.query<{ status: string; total: string }>(
      `select status, count(*) as total from mobile_api_operations group by status order by status`,
    );
    expect(rows.map((r) => [r.status, Number(r.total)])).toEqual([
      ["complete", 8],
      ["processing", 6],
    ]);
  });

  it("exposes both functions to the service role only", async () => {
    const { rows } = await db.query<{ role: string; due: boolean; prune: boolean }>(
      `select r.role,
         has_function_privilege(r.role, 'public.list_due_credit_expiries(timestamp, integer)', 'execute') as due,
         has_function_privilege(r.role, 'public.prune_mobile_operations(timestamptz, integer)', 'execute') as prune
       from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
       order by r.role`,
    );
    expect(rows).toEqual([
      { role: "anon", due: false, prune: false },
      { role: "authenticated", due: false, prune: false },
      { role: "service_role", due: true, prune: true },
    ]);
  });
});
