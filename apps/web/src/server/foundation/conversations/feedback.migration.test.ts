// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";

/**
 * Feedback on hAI's replies, on every repository migration in embedded PostgreSQL: one
 * rating per member per reply, kept when the reply is replaced by "Answer again", removed
 * with the conversation, and visible only to the member who gave it.
 */

let db: PGlite;
const owner = "11111111-1111-4111-8111-1111111111c1";
const colleague = "11111111-1111-4111-8111-1111111111c2";
const workspace = "22222222-2222-4222-8222-2222222222c2";
let conversation: string;
let reply: string;

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
    "insert into users(id,email) values ($1,'owner@test.invalid'), ($2,'colleague@test.invalid')",
    [owner, colleague],
  );
  await db.query(
    "insert into workspaces(id,name,slug,owner_user_id) values($1,'Feedback','feedback',$2)",
    [workspace, owner],
  );
  await db.query(
    `insert into workspace_members(workspace_id,user_id,role) values
       ($1,$2,'owner'), ($1,$3,'employee')`,
    [workspace, owner, colleague],
  );
  conversation = await insertId(
    "insert into ai_conversations(workspace_id,user_id) values($1,$2) returning id",
    [workspace, owner],
  );
  reply = await insertId(
    "insert into ai_messages(conversation_id,role,content) values($1,'assistant','Sales are up.') returning id",
    [conversation],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function insertId(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(sql, params);
  return rows[0]!.id;
}

async function rate(rating: string, comment: string | null = null): Promise<void> {
  // The same upsert the service runs.
  await db.query(
    `insert into ai_message_feedback(workspace_id,user_id,conversation_id,message_id,rating,comment,message_text)
     values ($1,$2,$3,$4,$5,$6,'Sales are up.')
     on conflict (message_id, user_id)
     do update set rating = excluded.rating, comment = excluded.comment, updated_at = now()`,
    [workspace, owner, conversation, reply, rating, comment],
  );
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

describe.sequential("hAI reply feedback on PostgreSQL", () => {
  it("keeps one rating per member per reply, and lets it change", async () => {
    await rate("up");
    await rate("down", "The total was wrong");
    const { rows } = await db.query<{ rating: string; comment: string | null }>(
      "select rating, comment from ai_message_feedback where message_id = $1",
      [reply],
    );
    expect(rows).toEqual([{ rating: "down", comment: "The total was wrong" }]);
  });

  it("accepts only up or down, and a note of at most 1000 characters", async () => {
    await expect(rate("meh")).rejects.toThrow(/ai_message_feedback_rating_check/);
    await expect(rate("down", "x".repeat(1001))).rejects.toThrow(
      /ai_message_feedback_comment_length/,
    );
  });

  it("is readable by the member who gave it and nobody else", async () => {
    const mine = await asUser(owner, () =>
      db.query<{ rating: string }>("select rating from ai_message_feedback"),
    );
    expect(mine.rows).toEqual([{ rating: "down" }]);
    const theirs = await asUser(colleague, () => db.query("select 1 from ai_message_feedback"));
    expect(theirs.rows).toHaveLength(0);
    await expect(
      asUser(owner, () => db.query("update ai_message_feedback set rating = 'up'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("outlives a reply that is answered again, with the reply's text", async () => {
    await db.query("delete from ai_messages where id = $1", [reply]);
    const { rows } = await db.query<{ message_id: string | null; message_text: string }>(
      "select message_id, message_text from ai_message_feedback where conversation_id = $1",
      [conversation],
    );
    expect(rows).toEqual([{ message_id: null, message_text: "Sales are up." }]);
  });

  it("goes when the conversation is deleted", async () => {
    await db.query("delete from ai_conversations where id = $1", [conversation]);
    const { rows } = await db.query("select 1 from ai_message_feedback");
    expect(rows).toHaveLength(0);
  });
});
