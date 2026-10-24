import { repositoryRoot } from "@/testing/paths";
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

let db: PGlite;
const user = "11111111-1111-4111-8111-111111111111";
const member = "22222222-2222-4222-8222-222222222222";
const workspace = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const expires = "2099-01-01T00:00:00Z";

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text);
    insert into auth.users values('11111111-1111-4111-8111-111111110099','admin@soletrade.example');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const directory = path.join(repositoryRoot, "supabase/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    try {
      await db.exec(await readFile(path.join(directory, file), "utf8"));
    } catch (cause) {
      throw new Error(`Migration ${file} failed`, { cause });
    }
  }
  await db.exec(`insert into users(id,email) values('${user}','owner@test.invalid'),('${member}','member@test.invalid');
    insert into workspaces(id,name,slug,owner_user_id) values('${workspace}','Mobile test','mobile-test','${user}'),('${other}','Other','other-test','${user}');
    insert into workspace_members(workspace_id,user_id,role) values('${workspace}','${user}','owner'),('${workspace}','${member}','admin'),('${other}','${user}','owner');
    insert into subscriptions(workspace_id,status) values('${workspace}','active'),('${other}','active');`);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function store(modules = ["books"], externalId = "apple-chain-1", target = workspace) {
  return db.query(
    `select mobile_apply_store_contract($1,$2,'apple',$3,'books_monthly',$4,'monthly','active',$5,null,true,'Sandbox') as result`,
    [user, target, externalId, modules, expires],
  );
}

describe.sequential("mobile additive migration on PostgreSQL", () => {
  it("installs every existing migration and denies native roles the privileged functions", async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated','mobile_apply_store_contract(uuid,uuid,text,text,text,text[],text,text,timestamptz,timestamptz,boolean,text,text,bigint,text[],text,uuid,text)','execute') as allowed",
    );
    expect(rows[0]?.allowed).toBe(false);
  });
  it("blocks a native purchase while a web checkout reservation is live", async () => {
    const reservation = "55555555-5555-4555-8555-555555555555";
    const result = await db.query<{ reserved: boolean }>(
      "select mobile_reserve_stripe_checkout($1,$2,now()+interval '35 minutes') as reserved",
      [workspace, reservation],
    );
    expect(result.rows[0]?.reserved).toBe(true);
    await expect(store()).rejects.toThrow(/coverage must end/);
    await db.query("select mobile_release_stripe_checkout($1,$2)", [workspace, reservation]);
    await db.query("select mobile_start_store_purchase_intent($1,$2,$3,'apple','books_monthly')", [
      reservation,
      user,
      workspace,
    ]);
    await store();
  });
  it("projects store modules atomically and ignores a late Stripe cancellation", async () => {
    const { rows } = await db.query<{ accepted: boolean }>(
      "select mobile_apply_stripe_contract($1,'old-stripe','{}','monthly','canceled',null,false,false) as accepted",
      [workspace],
    );
    expect(rows[0]?.accepted).toBe(false);
    const installed = await db.query<{ module_key: string; billing_contract_id: string }>(
      "select module_key,billing_contract_id from module_installations where workspace_id=$1 and status='active'",
      [workspace],
    );
    expect(installed.rows.map((row) => row.module_key)).toEqual(["books"]);
    expect(installed.rows[0]?.billing_contract_id).toBeTruthy();
  });
  it("does not allow a restored purchase to be rebound to another workspace", async () => {
    await expect(store(["books"], "apple-chain-1", other)).rejects.toThrow(/already linked/);
  });
  it("applies one reviewed receipt exactly once under repeated submissions", async () => {
    const file = "66666666-6666-4666-8666-666666666666",
      extraction = "77777777-7777-4777-8777-777777777777";
    await db.query(
      "insert into files(id,workspace_id,uploaded_by_user_id,file_name,mime_type,size_bytes,storage_path) values($1,$2,$3,'receipt.jpg','image/jpeg',100,'test/receipt.jpg')",
      [file, workspace, user],
    );
    await db.query(
      "insert into receipt_extractions(id,workspace_id,file_id,status,extracted_data,model_used) values($1,$2,$3,'pending','{}','test')",
      [extraction, workspace, file],
    );
    const transaction = {
      type: "expense",
      amount_cents: 1100,
      gst_cents: 100,
      currency: "AUD",
      date: "2026-10-25T00:00:00Z",
      description: "Receipt",
      category: "other_expense",
      customer_id: null,
      notes: null,
    };
    const first = await db.query<{ id: string }>("select mobile_apply_receipt($1,$2,$3,$4) as id", [
      workspace,
      extraction,
      user,
      transaction,
    ]);
    const second = await db.query<{ id: string }>(
      "select mobile_apply_receipt($1,$2,$3,$4) as id",
      [workspace, extraction, user, transaction],
    );
    expect(first.rows[0]?.id).toBe(second.rows[0]?.id);
    expect(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from book_transactions where receipt_file_id=$1",
          [file],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });
  it("keeps private GPS rows unavailable to authenticated Data API users", async () => {
    const { rows } = await db.query<{ allowed: boolean }>(
      "select has_table_privilege('authenticated','mobile_routes','select') as allowed",
    );
    expect(rows[0]?.allowed).toBe(false);
  });
  it("uses one durable operation claim and never reveals another user's saved response", async () => {
    const operation = "99999999-9999-4999-8999-999999999999";
    const claim = () =>
      db.query<{ result: { state: string; response?: unknown } }>(
        "select mobile_claim_operation($1,$2,$3,'create-expense','same-payload') as result",
        [operation, user, workspace],
      );
    expect((await claim()).rows[0]?.result.state).toBe("claimed");
    expect((await claim()).rows[0]?.result.state).toBe("pending");
    await db.query(
      "update mobile_api_operations set status='complete',response='{\"id\":\"original\"}' where id=$1",
      [operation],
    );
    expect((await claim()).rows[0]?.result).toEqual({
      state: "complete",
      response: { id: "original" },
    });
    const otherUser = await db.query<{ result: { state: string } }>(
      "select mobile_claim_operation($1,$2,$3,'create-expense','same-payload') as result",
      [operation, member, workspace],
    );
    expect(otherUser.rows[0]?.result).toEqual({ state: "mismatch" });
  });
  it("checks expected financial versions under the update lock and advances even within one millisecond", async () => {
    const row = (
      await db.query<{ id: string; stamp: string }>(
        `select id,to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as stamp from book_transactions where workspace_id=$1 limit 1`,
        [workspace],
      )
    ).rows[0]!;
    await db.query(
      "update book_transactions set amount_cents=1200,mobile_expected_updated_at=$2 where id=$1",
      [row.id, row.stamp],
    );
    await expect(
      db.query(
        "update book_transactions set amount_cents=1300,mobile_expected_updated_at=$2 where id=$1",
        [row.id, row.stamp],
      ),
    ).rejects.toThrow(/record changed/);
    expect(
      (
        await db.query<{ amount_cents: number }>(
          "select amount_cents from book_transactions where id=$1",
          [row.id],
        )
      ).rows[0]?.amount_cents,
    ).toBe(1200);
  });
  it("accepts verified Google linked-token replacements and rejects older verification snapshots", async () => {
    await db.query(
      "update billing_contracts set status='expired',paid_through=now()-interval '1 day' where workspace_id=$1 and current",
      [workspace],
    );
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-old','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,50)",
      [user, workspace, expires],
    );
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-new','books_drive_monthly',array['books','drive'],'monthly','active',$3,null,true,'Sandbox','google-old',51)",
      [user, workspace, expires],
    );
    expect(
      (
        await db.query<{ external_id: string }>(
          "select external_id from store_workspace_bindings where user_id=$1 and active",
          [user],
        )
      ).rows.map((row) => row.external_id),
    ).toEqual(["google-new"]);
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-new','books_drive_monthly',array['books','drive'],'monthly','revoked',$3,null,false,'Sandbox',null,53)",
      [user, workspace, expires],
    );
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-new','books_drive_monthly',array['books','drive'],'monthly','active',$3,null,true,'Sandbox',null,52)",
      [user, workspace, expires],
    );
    expect(
      (
        await db.query(
          "select module_key from module_installations where workspace_id=$1 and status='active'",
          [workspace],
        )
      ).rows,
    ).toHaveLength(0);
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-new','books_drive_monthly',array['books','drive'],'monthly','active',$3,null,true,'Sandbox',null,54)",
      [user, workspace, expires],
    );
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-old','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,55)",
      [user, workspace, expires],
    );
    expect(
      (
        await db.query<{ external_id: string }>(
          "select external_id from billing_contracts where workspace_id=$1 and current",
          [workspace],
        )
      ).rows[0]?.external_id,
    ).toBe("google-new");
  });
  it("reactivates the original Apple chain after another provider expires without displacing live coverage", async () => {
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-new','books_drive_monthly',array['books','drive'],'monthly','expired',now()-interval '1 day',null,false,'Sandbox',null,56)",
      [user, workspace],
    );
    const restored = await db.query<{ result: { provider: string; stale?: boolean } }>(
      "select mobile_apply_store_contract($1,$2,'apple','apple-chain-1','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,57) as result",
      [user, workspace, expires],
    );
    expect(restored.rows[0]?.result.provider).toBe("apple");
    expect(restored.rows[0]?.result.stale).toBeUndefined();
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','google-old','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,58)",
      [user, workspace, expires],
    );
    expect(
      (
        await db.query<{ provider: string }>(
          "select provider from billing_contracts where workspace_id=$1 and current",
          [workspace],
        )
      ).rows[0]?.provider,
    ).toBe("apple");
  });

  it.each(["billing_retry", "on_hold", "paused"])(
    "retains exclusive authority without access during %s and recovers the original chain",
    async (status) => {
      await db.exec("begin");
      try {
        const provider = status === "billing_retry" ? "apple" : "google";
        const externalId = provider === "apple" ? "apple-chain-1" : "google-new";
        // End current Apple coverage so the Google fixtures can become current.
        if (provider === "google") {
          await db.query(
            "select mobile_apply_store_contract($1,$2,'apple','apple-chain-1','books_monthly',array['books'],'monthly','expired',now()-interval '1 day',null,false,'Sandbox',null,80)",
            [user, workspace],
          );
          await db.query(
            "select mobile_apply_store_contract($1,$2,'google',$3,'books_monthly',array['books'],'monthly','active',$4,null,true,'Sandbox',null,81)",
            [user, workspace, externalId, expires],
          );
        }
        await db.query(
          "select mobile_apply_store_contract($1,$2,$3,$4,'books_monthly',array['books'],'monthly',$5,now()-interval '1 day',null,true,'Sandbox',null,82,array['drive'],'annual')",
          [user, workspace, provider, externalId, status],
        );
        expect(
          (
            await db.query(
              "select id from module_installations where workspace_id=$1 and status='active'",
              [workspace],
            )
          ).rows,
        ).toHaveLength(0);
        expect(
          (
            await db.query<{ pending_modules: string[] }>(
              "select pending_modules from billing_contracts where workspace_id=$1 and current",
              [workspace],
            )
          ).rows[0]?.pending_modules,
        ).toEqual(["drive"]);
        const intent = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
        expect(
          (
            await db.query<{ accepted: boolean }>(
              "select mobile_reserve_stripe_checkout($1,$2,now()+interval '35 minutes') as accepted",
              [workspace, intent],
            )
          ).rows[0]?.accepted,
        ).toBe(false);
        expect(
          (
            await db.query<{ accepted: boolean }>(
              "select mobile_apply_stripe_contract($1,'unexpected-stripe',array['drive'],'monthly','active',$2,true,true) as accepted",
              [workspace, expires],
            )
          ).rows[0]?.accepted,
        ).toBe(false);
        for (const target of ["apple", "google"]) {
          await db.exec("savepoint denied_recovery_purchase");
          await expect(
            db.query("select mobile_start_store_purchase_intent($1,$2,$3,$4,'books_monthly')", [
              intent,
              user,
              workspace,
              target,
            ]),
          ).rejects.toThrow(/original store/);
          await db.exec("rollback to savepoint denied_recovery_purchase");
        }
        await db.exec("savepoint denied_recovery_apply");
        await expect(
          db.query(
            "select mobile_apply_store_contract($1,$2,$3,'new-cross-provider','books_monthly',array['books'],'monthly','active',$4,null,true,'Sandbox',null,83)",
            [user, workspace, provider === "apple" ? "google" : "apple", expires],
          ),
        ).rejects.toThrow(/coverage must end/);
        await db.exec("rollback to savepoint denied_recovery_apply");
        await db.query(
          "select mobile_apply_store_contract($1,$2,$3,$4,'books_monthly',array['books'],'monthly','active',$5,null,true,'Sandbox',null,84)",
          [user, workspace, provider, externalId, expires],
        );
        expect(
          (
            await db.query(
              "select id from module_installations where workspace_id=$1 and status='active'",
              [workspace],
            )
          ).rows,
        ).toHaveLength(1);
        expect(
          (
            await db.query<{ external_id: string; status: string }>(
              "select external_id,status from billing_contracts where workspace_id=$1 and current",
              [workspace],
            )
          ).rows[0],
        ).toEqual({ external_id: externalId, status: "active" });
      } finally {
        await db.exec("rollback");
      }
    },
  );

  it.each(["active", "grace", "canceled"])(
    "preserves %s coverage until the store coverage date ends",
    async (status) => {
      await db.exec("begin");
      try {
        await db.query("update billing_contracts set status=$2 where workspace_id=$1 and current", [
          workspace,
          status,
        ]);
        expect(
          (
            await db.query<{ reserved: boolean }>(
              "select mobile_reserve_stripe_checkout($1,$2,now()+interval '35 minutes') as reserved",
              [workspace, "cccccccc-cccc-4ccc-8ccc-ccccccccccc2"],
            )
          ).rows[0]?.reserved,
        ).toBe(false);
        await db.exec("savepoint denied_intent");
        await expect(
          db.query("select mobile_start_store_purchase_intent($1,$2,$3,'google','books_monthly')", [
            "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
            user,
            workspace,
          ]),
        ).rejects.toThrow(/coverage must end/);
        await db.exec("rollback to savepoint denied_intent");
        await expect(
          db.query(
            "select mobile_apply_store_contract($1,$2,'google','fresh-google','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,70)",
            [user, workspace, expires],
          ),
        ).rejects.toThrow(/coverage must end/);
      } finally {
        await db.exec("rollback");
      }
    },
  );

  it.each(["revoked", "refunded", "expired"])(
    "allows provider changes after %s even with a future old expiry",
    async (status) => {
      const intent = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
      const revoke = (revision: number) =>
        db.query(
          "select mobile_apply_store_contract($1,$2,'apple','apple-chain-1','books_monthly',array['books'],'monthly',$3,$4,null,false,'Sandbox',null,$5)",
          [user, workspace, status, expires, revision],
        );
      await db.exec("begin");
      try {
        await revoke(70);
        expect(
          (
            await db.query<{ id: string }>(
              "select mobile_start_store_purchase_intent($1,$2,$3,'google','books_monthly') as id",
              [intent, user, workspace],
            )
          ).rows[0]?.id,
        ).toBe(intent);
        await db.query(
          "select mobile_apply_store_contract($1,$2,'google','google-new','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,71,null,null,$4)",
          [user, workspace, expires, intent],
        );
        await revoke(72);
        expect(
          (
            await db.query<{ provider: string; status: string }>(
              "select provider,status from billing_contracts where workspace_id=$1 and current",
              [workspace],
            )
          ).rows[0],
        ).toEqual({ provider: "google", status: "active" });
        expect(
          (
            await db.query(
              "select id from module_installations where workspace_id=$1 and status='active'",
              [workspace],
            )
          ).rows,
        ).toHaveLength(1);
      } finally {
        await db.exec("rollback");
      }
      await db.exec("begin");
      try {
        await revoke(70);
        expect(
          (
            await db.query<{ reserved: boolean }>(
              "select mobile_reserve_stripe_checkout($1,$2,now()+interval '35 minutes') as reserved",
              [workspace, intent],
            )
          ).rows[0]?.reserved,
        ).toBe(true);
        await revoke(72);
        expect(
          (
            await db.query<{ provider: string }>(
              "select provider from billing_contracts where workspace_id=$1 and current",
              [workspace],
            )
          ).rows[0]?.provider,
        ).toBe("stripe");
      } finally {
        await db.exec("rollback");
      }
    },
  );

  it("reserves the purchaser and workspace before a sheet, retains uncertainty, and consumes only the verified offer", async () => {
    const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
    const intent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      next = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
    await db.query(
      "insert into workspaces(id,name,slug,owner_user_id) values($1,'Intent one','intent-one',$3),($2,'Intent two','intent-two',$3)",
      [first, second, member],
    );
    const start = (
      operation: string,
      target = first,
      offer = "books_monthly",
      provider = "google",
    ) =>
      db.query<{ id: string }>("select mobile_start_store_purchase_intent($1,$2,$3,$4,$5) as id", [
        operation,
        member,
        target,
        provider,
        offer,
      ]);
    expect((await start(intent)).rows[0]?.id).toBe(intent);
    expect((await start(next)).rows[0]?.id).toBe(intent);
    await expect(start(next, second, "books_monthly", "apple")).rejects.toThrow(/pending/);
    await expect(start(next, first, "drive_monthly")).rejects.toThrow(/pending/);
    expect(
      (
        await db.query<{ reserved: boolean }>(
          "select mobile_reserve_stripe_checkout($1,$2,now()+interval '35 minutes') as reserved",
          [first, next],
        )
      ).rows[0]?.reserved,
    ).toBe(false);
    await db.query(
      "update mobile_store_purchase_intents set created_at=now()-interval '60 days',updated_at=now()-interval '60 days' where id=$1",
      [intent],
    );
    await expect(start(next, second)).rejects.toThrow(/pending/);
    await expect(
      db.query("select mobile_cancel_store_purchase_intent($1,$2,$3)", [intent, user, first]),
    ).rejects.toThrow(/owner/);
    expect(
      (
        await db.query<{ cancelled: boolean }>(
          "select mobile_cancel_store_purchase_intent($1,$2,$3) as cancelled",
          [intent, member, first],
        )
      ).rows[0]?.cancelled,
    ).toBe(true);
    expect(
      (
        await db.query<{ reserved: boolean }>(
          "select mobile_reserve_stripe_checkout($1,$2,now()+interval '35 minutes') as reserved",
          [first, next],
        )
      ).rows[0]?.reserved,
    ).toBe(true);
    await expect(start(next)).rejects.toThrow(/coverage must end/);
    await db.query("select mobile_release_stripe_checkout($1,$2)", [first, next]);
    await start(next);
    const apply = (key: string) =>
      db.query(
        "select mobile_apply_store_contract($1,$2,'google','reserved-google',$3,array['books'],'monthly','active',$4,null,true,'Sandbox',null,60,null,null,$5)",
        [member, first, key, expires, next],
      );
    await expect(apply("drive_monthly")).rejects.toThrow(/original intent/);
    await apply("books_monthly");
    expect(
      (
        await db.query<{ status: string }>(
          "select status from mobile_store_purchase_intents where id=$1",
          [next],
        )
      ).rows[0]?.status,
    ).toBe("complete");
    await db.query(
      "select mobile_apply_store_contract($1,$2,'google','reserved-google','books_monthly',array['books'],'monthly','expired',now()-interval '1 day',null,false,'Sandbox',null,61)",
      [member, first],
    );
    await expect(start("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", second)).rejects.toThrow(
      /originally selected/,
    );
    await expect(
      db.query(
        "select mobile_apply_store_contract($1,$2,'apple','unreserved-apple','books_monthly',array['books'],'monthly','active',$3,null,true,'Sandbox',null,62)",
        [member, first, expires],
      ),
    ).rejects.toThrow(/original Apple purchase intent/);
  });

  it("transfers shared ownership only after the intended member accepts", async () => {
    const transfer = "88888888-8888-4888-8888-888888888888";
    await db.query(
      "insert into workspace_ownership_transfers(id,workspace_id,from_user_id,to_user_id) values($1,$2,$3,$4)",
      [transfer, workspace, user, member],
    );
    await expect(
      db.query("select mobile_accept_transfer($1,$2)", [transfer, user]),
    ).rejects.toThrow(/unavailable/);
    await db.exec("begin");
    try {
      await db.query("update users set deleted_at=now() where id=$1", [member]);
      await expect(
        db.query("select mobile_accept_transfer($1,$2)", [transfer, member]),
      ).rejects.toThrow(/Recipient account unavailable/);
    } finally {
      await db.exec("rollback");
    }
    await db.query("select mobile_accept_transfer($1,$2)", [transfer, member]);
    expect(
      (
        await db.query<{ owner_user_id: string }>(
          "select owner_user_id from workspaces where id=$1",
          [workspace],
        )
      ).rows[0]?.owner_user_id,
    ).toBe(member);
  });
  it("closes immediately, purges the closed workspace and preserves shared business records", async () => {
    const pendingIntent = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
    // Reserved before ownership transfer; the unresolved personal state must not
    // permanently block the continuing workspace after its purchaser is purged.
    await db.query(
      "insert into mobile_store_purchase_intents(id,user_id,workspace_id,provider,offer_key) values($1,$2,$3,'apple','books_monthly')",
      [pendingIntent, user, workspace],
    );
    await db.query("select mobile_close_account($1,$2)", [user, [other]]);
    expect(
      (
        await db.query<{ deleted_at: string | null }>("select deleted_at from users where id=$1", [
          user,
        ])
      ).rows[0]?.deleted_at,
    ).not.toBeNull();
    await db.query(
      "update account_deletion_requests set purge_after=now()-interval '1 minute' where user_id=$1",
      [user],
    );
    // A captured closure list must never override a transfer that has since completed.
    await db.query(
      "update account_deletion_requests set closed_workspace_ids=array_append(closed_workspace_ids,$2::uuid) where user_id=$1",
      [user, workspace],
    );
    await db.query("select mobile_purge_account($1)", [user]);
    expect(
      (await db.query("select id from mobile_store_purchase_intents where user_id=$1", [user]))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "select id from store_workspace_bindings where user_id=$1 and workspace_id=$2",
          [user, workspace],
        )
      ).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (
        await db.query("select id from billing_contracts where workspace_id=$1 and current", [
          workspace,
        ])
      ).rows,
    ).toHaveLength(1);
    expect((await db.query("select id from workspaces where id=$1", [other])).rows).toHaveLength(0);
    expect(
      (await db.query("select id from book_transactions where workspace_id=$1", [workspace])).rows,
    ).toHaveLength(1);
    expect(
      (await db.query<{ email: string }>("select email from users where id=$1", [user])).rows[0]
        ?.email,
    ).toContain("@invalid.local");
  });
});
