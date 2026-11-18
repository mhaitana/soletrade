// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";

/**
 * The hAI usage ledger on every repository migration in embedded PostgreSQL: one call
 * recorded as an event plus its month's totals, repeated calls adding up, writes only
 * through the service role, and rows readable only by the workspace's owners and admins.
 */

let db: PGlite;
const owner = "11111111-1111-4111-8111-1111111111c1";
const admin = "11111111-1111-4111-8111-1111111111c2";
const employee = "11111111-1111-4111-8111-1111111111c3";
const outsider = "11111111-1111-4111-8111-1111111111c4";
const workspace = "22222222-2222-4222-8222-2222222222c1";
const otherWorkspace = "22222222-2222-4222-8222-2222222222c2";

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
       ($1,'owner@test.invalid'), ($2,'admin@test.invalid'),
       ($3,'employee@test.invalid'), ($4,'outsider@test.invalid')`,
    [owner, admin, employee, outsider],
  );
  // The outsider owns a second workspace: an owner elsewhere is still not an admin here.
  await db.query(
    `insert into workspaces(id,name,slug,owner_user_id) values
       ($1,'Usage','usage',$3), ($2,'Elsewhere','usage-elsewhere',$4)`,
    [workspace, otherWorkspace, owner, outsider],
  );
  await db.query(
    `insert into workspace_members(workspace_id,user_id,role) values
       ($1,$3,'owner'), ($1,$4,'admin'), ($1,$5,'employee'), ($2,$6,'owner')`,
    [workspace, otherWorkspace, owner, admin, employee, outsider],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

interface UsageCall {
  workspaceId?: string;
  feature?: string;
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  steps?: number | null;
  userId?: string | null;
  conversationId?: string | null;
  surface?: string | null;
  createdAt?: string | null;
}

/** Call the RPC the way the service does, with every argument named. */
async function record(call: UsageCall = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.record_ai_usage(
       p_workspace_id => $1, p_feature => $2, p_provider => 'anthropic', p_model => 'test-model',
       p_input_tokens => $3, p_output_tokens => $4, p_cache_read_tokens => $5,
       p_cache_write_tokens => $6, p_step_count => $7, p_user_id => $8,
       p_conversation_id => $9, p_surface => $10, p_created_at => $11
     ) as id`,
    [
      call.workspaceId ?? workspace,
      call.feature ?? "chat",
      call.input === undefined ? 1000 : call.input,
      call.output === undefined ? 200 : call.output,
      call.cacheRead === undefined ? 600 : call.cacheRead,
      call.cacheWrite === undefined ? 100 : call.cacheWrite,
      call.steps === undefined ? 2 : call.steps,
      call.userId === undefined ? owner : call.userId,
      call.conversationId ?? null,
      call.surface === undefined ? "web" : call.surface,
      call.createdAt ?? "2026-11-18T03:00:00Z",
    ],
  );
  return rows[0]!.id;
}

interface MonthRow {
  month: string;
  feature: string;
  call_count: number;
  step_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

async function monthly(workspaceId = workspace): Promise<MonthRow[]> {
  const { rows } = await db.query<MonthRow>(
    `select to_char(month, 'YYYY-MM-DD') as month, feature,
            call_count::int, step_count::int, input_tokens::int, output_tokens::int,
            cache_read_tokens::int, cache_write_tokens::int
       from ai_usage_monthly where workspace_id = $1 order by month, feature`,
    [workspaceId],
  );
  return rows;
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

describe.sequential("hAI usage ledger on PostgreSQL", () => {
  it("records one call as an event and starts its month's totals", async () => {
    const id = await record();
    const { rows } = await db.query(
      `select workspace_id, user_id, conversation_id, feature, surface, provider, model,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, step_count
         from ai_usage_events where id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        workspace_id: workspace,
        user_id: owner,
        conversation_id: null,
        feature: "chat",
        surface: "web",
        provider: "anthropic",
        model: "test-model",
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 600,
        cache_write_tokens: 100,
        step_count: 2,
      },
    ]);
    expect(await monthly()).toEqual([
      {
        month: "2026-11-01",
        feature: "chat",
        call_count: 1,
        step_count: 2,
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_tokens: 600,
        cache_write_tokens: 100,
      },
    ]);
  });

  it("adds repeated calls to the same month and feature", async () => {
    await record({ input: 50, output: 5, cacheRead: 0, cacheWrite: 40, steps: 1 });
    await record({ input: 30, output: 3, cacheRead: 20, cacheWrite: 0, steps: 3 });
    expect(await monthly()).toEqual([
      {
        month: "2026-11-01",
        feature: "chat",
        call_count: 3,
        step_count: 6,
        input_tokens: 1080,
        output_tokens: 208,
        cache_read_tokens: 620,
        cache_write_tokens: 140,
      },
    ]);
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from ai_usage_events where workspace_id = $1",
      [workspace],
    );
    expect(rows[0]!.count).toBe(3);
  });

  it("keeps features, months and workspaces apart", async () => {
    await record({ feature: "title", input: 80, output: 8, cacheRead: 0, cacheWrite: 0, steps: 1 });
    // The month is the UTC one: this instant is still October in UTC, already November in Sydney.
    await record({ createdAt: "2026-10-31T23:30:00Z", input: 10, output: 1, steps: 1 });
    await record({ workspaceId: otherWorkspace, userId: outsider, input: 7, output: 7 });

    expect(
      (await monthly()).map((row) => [row.month, row.feature, row.call_count, row.input_tokens]),
    ).toEqual([
      ["2026-10-01", "chat", 1, 10],
      ["2026-11-01", "chat", 3, 1080],
      ["2026-11-01", "title", 1, 80],
    ]);
    expect((await monthly(otherWorkspace)).map((row) => [row.feature, row.input_tokens])).toEqual([
      ["chat", 7],
    ]);
  });

  it("stores missing or negative counts as zero, and a call without a user or surface", async () => {
    const id = await record({
      feature: "receipt",
      input: null,
      output: -5,
      cacheRead: null,
      cacheWrite: -1,
      steps: null,
      userId: null,
      surface: null,
    });
    const { rows } = await db.query(
      `select user_id, surface, input_tokens, output_tokens, cache_read_tokens,
              cache_write_tokens, step_count from ai_usage_events where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({
      user_id: null,
      surface: null,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      step_count: 1,
    });
  });

  it("rejects a feature that is not a short machine name", async () => {
    await expect(record({ feature: "Chat turn" })).rejects.toThrow(/ai_usage_events_feature_check/);
    // Nothing of the failed call is left behind: the event and the totals commit together.
    expect((await monthly()).some((row) => row.feature === "Chat turn")).toBe(false);
  });

  it("links a call to its conversation and keeps the usage when the conversation goes", async () => {
    const conversation = (
      await db.query<{ id: string }>(
        "insert into ai_conversations(workspace_id,user_id) values($1,$2) returning id",
        [workspace, owner],
      )
    ).rows[0]!.id;
    const foreign = (
      await db.query<{ id: string }>(
        "insert into ai_conversations(workspace_id,user_id) values($1,$2) returning id",
        [otherWorkspace, outsider],
      )
    ).rows[0]!.id;
    const conversationOf = async (id: string) =>
      (
        await db.query<{ conversation_id: string | null }>(
          "select conversation_id from ai_usage_events where id = $1",
          [id],
        )
      ).rows[0]!.conversation_id;

    const linked = await record({ conversationId: conversation });
    expect(await conversationOf(linked)).toBe(conversation);

    // Another workspace's conversation, or one that no longer exists, is not linked; the
    // call is still recorded.
    expect(await conversationOf(await record({ conversationId: foreign }))).toBeNull();
    expect(
      await conversationOf(
        await record({ conversationId: "99999999-9999-4999-8999-999999999999" }),
      ),
    ).toBeNull();

    await db.query("delete from ai_conversations where id = $1", [conversation]);
    expect(await conversationOf(linked)).toBeNull();
  });

  it("lets only owners and admins of the workspace read its usage", async () => {
    const visible = (userId: string) =>
      asUser(userId, async () => {
        const events = await db.query<{ count: number }>(
          "select count(*)::int as count from ai_usage_events where workspace_id = $1",
          [workspace],
        );
        const months = await db.query<{ count: number }>(
          "select count(*)::int as count from ai_usage_monthly where workspace_id = $1",
          [workspace],
        );
        return [events.rows[0]!.count, months.rows[0]!.count];
      });
    const total = (
      await db.query<{ count: number }>(
        "select count(*)::int as count from ai_usage_events where workspace_id = $1",
        [workspace],
      )
    ).rows[0]!.count;
    expect(total).toBeGreaterThan(0);
    const months = (await monthly()).length;

    expect(await visible(owner)).toEqual([total, months]);
    expect(await visible(admin)).toEqual([total, months]);
    expect(await visible(employee)).toEqual([0, 0]);
    // An owner of another workspace sees their own rows only.
    expect(await visible(outsider)).toEqual([0, 0]);
    const own = await asUser(outsider, async () => {
      const { rows } = await db.query<{ workspace_id: string }>(
        "select distinct workspace_id from ai_usage_events",
      );
      return rows.map((row) => row.workspace_id);
    });
    expect(own).toEqual([otherWorkspace]);
  });

  it("stops reading when the admin is removed from the workspace", async () => {
    await db.query(
      "update workspace_members set deleted_at = now() where workspace_id = $1 and user_id = $2",
      [workspace, admin],
    );
    const count = await asUser(admin, async () => {
      const { rows } = await db.query<{ count: number }>(
        "select count(*)::int as count from ai_usage_monthly",
      );
      return rows[0]!.count;
    });
    expect(count).toBe(0);
  });

  it("does not let a signed-in user write usage, directly or through the function", async () => {
    await expect(
      asUser(owner, () =>
        db.query(
          `insert into ai_usage_events(workspace_id,feature,provider,model)
           values ($1,'chat','anthropic','test-model')`,
          [workspace],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () => db.query("update ai_usage_monthly set input_tokens = 0")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () =>
        db.query("delete from ai_usage_events where workspace_id = $1", [workspace]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(owner, () => record())).rejects.toThrow(/permission denied/);
  });

  it("lets the service role record usage, linked to a conversation", async () => {
    const november = async () =>
      (await monthly()).find((row) => row.month === "2026-11-01" && row.feature === "chat")!;
    const before = await november();
    const conversation = (
      await db.query<{ id: string }>(
        "insert into ai_conversations(workspace_id,user_id) values($1,$2) returning id",
        [workspace, owner],
      )
    ).rows[0]!.id;
    let id = "";
    await db.exec("begin");
    try {
      await db.exec("set local role service_role");
      id = await record({
        conversationId: conversation,
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        steps: 1,
      });
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
    const after = await november();
    expect(after.call_count).toBe(before.call_count + 1);
    expect(after.input_tokens).toBe(before.input_tokens + 1);
    const { rows } = await db.query<{ conversation_id: string | null }>(
      "select conversation_id from ai_usage_events where id = $1",
      [id],
    );
    expect(rows[0]!.conversation_id).toBe(conversation);
  });

  it("removes a workspace's usage with the workspace", async () => {
    await db.query("delete from ai_conversations where workspace_id = $1", [otherWorkspace]);
    await db.query("delete from workspace_members where workspace_id = $1", [otherWorkspace]);
    await db.query("delete from workspaces where id = $1", [otherWorkspace]);
    const { rows } = await db.query<{ events: number; months: number }>(
      `select (select count(*)::int from ai_usage_events where workspace_id = $1) as events,
              (select count(*)::int from ai_usage_monthly where workspace_id = $1) as months`,
      [otherWorkspace],
    );
    expect(rows[0]).toEqual({ events: 0, months: 0 });
  });
});
