import { repositoryRoot } from "@/testing/paths";
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
let db: PGlite;
const first = "11111111-1111-4111-8111-111111111111",
  second = "22222222-2222-4222-8222-222222222222",
  workspace = "33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text);insert into auth.users values('11111111-1111-4111-8111-111111110099','admin@soletrade.example');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
  );
  const directory = path.join(repositoryRoot, "supabase/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort())
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  await db.exec(
    `insert into users(id,email) values('${first}','one@test.invalid'),('${second}','two@test.invalid');insert into workspaces(id,name,slug,owner_user_id) values('${workspace}','Push test','push-test','${first}');insert into workspace_members(workspace_id,user_id,role) values('${workspace}','${first}','owner'),('${workspace}','${second}','admin');`,
  );
}, 60_000);
afterAll(async () => {
  await db?.close();
});
async function register(user = first, device = "phone", token = "ExpoPushToken[alpha]") {
  return db.query("select mobile_register_device($1,$2,$3,'ios','Australia/Melbourne')", [
    user,
    device,
    token,
  ]);
}
async function seedDelivery(user = first, device = "phone", ticket = "receipt-alpha") {
  const n = await db.query<{ id: string }>(
    "insert into notifications(workspace_id,user_id,type,title) values($1,$2,'invoice.paid','Private notification') returning id",
    [workspace, user],
  );
  const j = await db.query<{ id: string }>(
    "select id from mobile_notification_outbox where notification_id=$1",
    [n.rows[0]!.id],
  );
  const d = await db.query<{ id: string }>(
    `insert into mobile_push_deliveries(outbox_id,user_id,device_id,token,registration_updated_at,status,ticket_id,accepted_at,receipt_status,receipt_poll_after) select $1,user_id,id,token,updated_at,'accepted',$3,now(),'pending',now()+interval '15 minutes' from mobile_devices where user_id=$2 and id=$4 returning id`,
    [j.rows[0]!.id, user, ticket, device],
  );
  return { outbox: j.rows[0]!.id, delivery: d.rows[0]!.id };
}
describe.sequential("private push delivery schema", () => {
  it("denies native roles ledger access and device registration RPC execution", async () => {
    const { rows } = await db.query<{ can_read: boolean; can_register: boolean }>(
      "select has_table_privilege('authenticated','mobile_push_deliveries','select') as can_read,has_function_privilege('authenticated','mobile_register_device(uuid,text,text,text,text)','execute') as can_register",
    );
    expect(rows[0]).toEqual({ can_read: false, can_register: false });
    const service = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('service_role','mobile_register_device(uuid,text,text,text,text)','execute') as allowed",
    );
    expect(service.rows[0]?.allowed).toBe(true);
  });
  it("preserves accepted delivery history and advances registration time on same-device refresh", async () => {
    await register();
    const history = await seedDelivery();
    const before = await db.query<{ updated_at: string }>(
      "select updated_at::text from mobile_devices where user_id=$1 and id='phone'",
      [first],
    );
    await register(first, "phone", "ExpoPushToken[beta]");
    const after = await db.query<{ token: string; newer: boolean }>(
      "select token,updated_at>$2::timestamptz as newer from mobile_devices where user_id=$1 and id='phone'",
      [first, before.rows[0]!.updated_at],
    );
    expect(after.rows[0]).toEqual({ token: "ExpoPushToken[beta]", newer: true });
    const ledger = await db.query<{ ticket_id: string }>(
      "select ticket_id from mobile_push_deliveries where id=$1",
      [history.delivery],
    );
    expect(ledger.rows[0]?.ticket_id).toBe("receipt-alpha");
  });
  it("atomically moves an existing token to the latest authenticated account without a unique conflict", async () => {
    await register(second, "phone-two", "ExpoPushToken[beta]");
    const { rows } = await db.query<{ user_id: string; id: string }>(
      "select user_id,id from mobile_devices where token='ExpoPushToken[beta]'",
    );
    expect(rows).toEqual([{ user_id: second, id: "phone-two" }]);
    expect(
      (await db.query("select id from mobile_devices where user_id=$1 and id='phone'", [first]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select id from mobile_push_deliveries where user_id=$1", [first])).rows,
    ).toHaveLength(0);
  });
  it("deletes token snapshots and receipt rows when their outbox job is purged", async () => {
    const history = await seedDelivery(second, "phone-two", "receipt-beta");
    await db.query("delete from mobile_notification_outbox where id=$1", [history.outbox]);
    expect(
      (await db.query("select id from mobile_push_deliveries where id=$1", [history.delivery]))
        .rows,
    ).toHaveLength(0);
  });
  it("enforces one recipient ledger row per job and device", async () => {
    const history = await seedDelivery(second, "phone-two", "receipt-gamma");
    await expect(
      db.query(
        "insert into mobile_push_deliveries(outbox_id,user_id,device_id,token,registration_updated_at) select outbox_id,user_id,device_id,token,registration_updated_at from mobile_push_deliveries where id=$1",
        [history.delivery],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});
