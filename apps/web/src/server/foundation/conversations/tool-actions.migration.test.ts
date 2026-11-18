// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";

/**
 * The hAI action ledger and whole-message columns, on every repository migration in
 * embedded PostgreSQL: one row per proposed call, status changes that only succeed from
 * the expected status (so a change cannot run twice), cleanup with the conversation, and
 * rows visible only to the member who owns the conversation.
 */

let db: PGlite;
const owner = "11111111-1111-4111-8111-1111111111b1";
const colleague = "11111111-1111-4111-8111-1111111111b2";
const outsider = "11111111-1111-4111-8111-1111111111b3";
const workspace = "22222222-2222-4222-8222-2222222222b2";
let conversation: string;

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key,email text);
    -- The admin-area migration seeds this account unless it already exists.
    insert into auth.users values('11111111-1111-4111-8111-111111110099','admin@soletrade.example');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
  `);
  const directory = path.join(repositoryRoot, "supabase/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(path.join(directory, file), "utf8"));
  }
  await db.query(
    `insert into users(id,email) values
       ($1,'owner@test.invalid'), ($2,'colleague@test.invalid'), ($3,'outsider@test.invalid')`,
    [owner, colleague, outsider],
  );
  await db.query(
    "insert into workspaces(id,name,slug,owner_user_id) values($1,'Ledger','ledger',$2)",
    [workspace, owner],
  );
  await db.query(
    `insert into workspace_members(workspace_id,user_id,role) values
       ($1,$2,'owner'), ($1,$3,'employee')`,
    [workspace, owner, colleague],
  );
  conversation = await newConversation();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function newConversation(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into ai_conversations(workspace_id,user_id) values($1,$2) returning id",
    [workspace, owner],
  );
  return rows[0]!.id;
}

async function propose(conversationId: string, toolCallId: string): Promise<void> {
  await db.query(
    `insert into ai_tool_actions(workspace_id,user_id,conversation_id,tool_call_id,tool_name,input,preview)
     values ($1,$2,$3,$4,'sendInvoice',$5::jsonb,$6::jsonb)`,
    [
      workspace,
      owner,
      conversationId,
      toolCallId,
      JSON.stringify({ number: "INV-7" }),
      JSON.stringify({ title: "Send invoice INV-7", details: [] }),
    ],
  );
}

/** The same conditional update the service runs: it changes the row only from `from`. */
async function transition(toolCallId: string, from: string, to: string): Promise<number> {
  const result = await db.query(
    `update ai_tool_actions set status = $3::ai_tool_action_status
     where conversation_id = $1 and tool_call_id = $2 and status = $4::ai_tool_action_status`,
    [conversation, toolCallId, to, from],
  );
  return result.affectedRows ?? 0;
}

async function asUser<T>(userId: string, query: () => Promise<T>): Promise<T> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.exec("set local role authenticated");
    return await query();
  } finally {
    await db.exec("rollback");
  }
}

describe.sequential("hAI action ledger on PostgreSQL", () => {
  it("stores whole messages next to their plain text", async () => {
    const parts = [{ type: "text", text: "Hello" }];
    const { rows } = await db.query<{ parts: unknown; metadata: unknown }>(
      `insert into ai_messages(conversation_id,role,content,parts,metadata)
       values ($1,'assistant','Hello',$2::jsonb,$3::jsonb) returning parts, metadata`,
      [conversation, JSON.stringify(parts), JSON.stringify({ model: "test" })],
    );
    expect(rows[0]).toEqual({ parts, metadata: { model: "test" } });
    // Rows from before the migration have text only.
    await db.query(
      "insert into ai_messages(conversation_id,role,content) values ($1,'user','Older')",
      [conversation],
    );
  });

  it("records each proposed call once per conversation", async () => {
    await propose(conversation, "call-1");
    await expect(propose(conversation, "call-1")).rejects.toThrow(/ai_tool_actions_call_unique/);
    const other = await newConversation();
    await propose(other, "call-1");
  });

  it("starts pending and changes status only from the expected one", async () => {
    const { rows } = await db.query<{ status: string }>(
      "select status from ai_tool_actions where conversation_id = $1 and tool_call_id = 'call-1'",
      [conversation],
    );
    expect(rows[0]!.status).toBe("pending");

    // Two approvals of the same change: only the first takes effect.
    expect(await transition("call-1", "pending", "approved")).toBe(1);
    expect(await transition("call-1", "pending", "approved")).toBe(0);
    expect(await transition("call-1", "pending", "denied")).toBe(0);
    // Claiming the run: only one request can move it to running.
    expect(await transition("call-1", "approved", "running")).toBe(1);
    expect(await transition("call-1", "approved", "running")).toBe(0);
    expect(await transition("call-1", "running", "succeeded")).toBe(1);
  });

  it("rejects a status that does not exist", async () => {
    await propose(conversation, "call-2");
    await expect(transition("call-2", "pending", "done")).rejects.toThrow();
  });

  it("shows ledger rows only to the member who owns the conversation", async () => {
    const visible = (userId: string) =>
      asUser(userId, async () => {
        const { rows } = await db.query<{ tool_call_id: string }>(
          "select tool_call_id from ai_tool_actions where conversation_id = $1 order by tool_call_id",
          [conversation],
        );
        return rows.map((row) => row.tool_call_id);
      });
    expect(await visible(owner)).toEqual(["call-1", "call-2"]);
    expect(await visible(colleague)).toEqual([]);
    expect(await visible(outsider)).toEqual([]);
  });

  it("does not let a signed-in user write to the ledger directly", async () => {
    await expect(
      asUser(owner, () =>
        db.query("update ai_tool_actions set status = 'approved' where tool_call_id = 'call-2'"),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () =>
        db.query(
          `insert into ai_tool_actions(workspace_id,user_id,conversation_id,tool_call_id,tool_name,input)
           values ($1,$2,$3,'call-9','sendInvoice','{}'::jsonb)`,
          [workspace, owner, conversation],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("removes the ledger with its conversation", async () => {
    await db.query("delete from ai_conversations where id = $1", [conversation]);
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from ai_tool_actions where conversation_id = $1",
      [conversation],
    );
    expect(rows[0]!.count).toBe(0);
  });
});
