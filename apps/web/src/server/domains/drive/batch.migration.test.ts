// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";

let db: PGlite;
const actor = "11111111-1111-4111-8111-111111111111";
const workspace = "22222222-2222-4222-8222-222222222222";

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
  await db.query("insert into users(id,email) values($1,'drive-batch@test.invalid')", [actor]);
  await db.query(
    "insert into workspaces(id,name,slug,owner_user_id) values($1,'Drive Batch','drive-batch',$2)",
    [workspace, actor],
  );
  await db.query(
    "insert into module_installations(workspace_id,module_key) values($1,'drive'),($1,'books')",
    [workspace],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** Exercise the single multi-row INSERT used by PostgREST, with the real mirror triggers. */
async function insertBatch(
  earnings: { platform: string; amount_cents: number; date: string; description: string }[],
) {
  return db.query<{ id: string; platform: string }>(
    `
    insert into drive_earnings(workspace_id,platform,amount_cents,currency,date,description)
    select $1, e.platform, e.amount_cents, 'AUD', e.date, e.description
    from jsonb_to_recordset($2::jsonb) as e(platform text, amount_cents integer, date timestamp, description text)
    returning id, platform
  `,
    [workspace, JSON.stringify(earnings)],
  );
}

describe.sequential("Drive batch Books mirrors on PostgreSQL", () => {
  it("commits every earning and its Books mirror without event subscribers", async () => {
    const saved = await insertBatch([
      { platform: "uber", amount_cents: 12550, date: "2026-10-20", description: "Tuesday shift" },
      {
        platform: "doordash",
        amount_cents: 7900,
        date: "2026-10-21",
        description: "Wednesday shift",
      },
    ]);
    expect(saved.rows).toHaveLength(2);
    const books = await db.query(
      `
      select source_earning_id, type, category, amount_cents, date::text, currency
      from book_transactions where workspace_id=$1 order by amount_cents
    `,
      [workspace],
    );
    expect(books.rows).toEqual([
      {
        source_earning_id: saved.rows.find((row) => row.platform === "doordash")!.id,
        type: "income",
        category: "gig",
        amount_cents: 7900,
        date: "2026-10-21 00:00:00",
        currency: "AUD",
      },
      {
        source_earning_id: saved.rows.find((row) => row.platform === "uber")!.id,
        type: "income",
        category: "gig",
        amount_cents: 12550,
        date: "2026-10-20 00:00:00",
        currency: "AUD",
      },
    ]);
  });

  it("rolls back every earning and mirror when the second mirror fails", async () => {
    const before = await db.query("select id from book_transactions where workspace_id=$1", [
      workspace,
    ]);
    await db.exec(`
      create function fail_batch_mirror_test() returns trigger language plpgsql as $$
        begin
          if new.amount_cents=4200 then raise exception 'Injected mirror failure'; end if;
          return new;
        end
      $$;
      create trigger fail_batch_mirror_test before insert on book_transactions
      for each row execute function fail_batch_mirror_test();
    `);
    try {
      await expect(
        insertBatch([
          {
            platform: "uber",
            amount_cents: 3100,
            date: "2026-10-22",
            description: "Must roll back",
          },
          {
            platform: "doordash",
            amount_cents: 4200,
            date: "2026-10-22",
            description: "Mirror failure",
          },
        ]),
      ).rejects.toThrow("Injected mirror failure");

      const earnings = await db.query(
        "select id from drive_earnings where workspace_id=$1 and description in ('Must roll back','Mirror failure')",
        [workspace],
      );
      expect(earnings.rows).toHaveLength(0);
      const after = await db.query("select id from book_transactions where workspace_id=$1", [
        workspace,
      ]);
      expect(after.rows).toHaveLength(before.rows.length);
    } finally {
      await db.exec(
        "drop trigger fail_batch_mirror_test on book_transactions; drop function fail_batch_mirror_test()",
      );
    }
  });
});
