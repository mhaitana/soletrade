// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { repositoryRoot } from "@/testing/paths";

/**
 * The briefing facts and the digest claim, on every repository migration in embedded
 * PostgreSQL: facts count only what the definitions say and only for the workspace asked
 * about, a member sees and changes only their own digest choice, and a member is claimed
 * at most once per period however often the job runs.
 */

let db: PGlite;
const owner = "11111111-1111-4111-8111-1111111111c1";
const colleague = "11111111-1111-4111-8111-1111111111c2";
const outsider = "11111111-1111-4111-8111-1111111111c3";
const leaver = "11111111-1111-4111-8111-1111111111c4";
const closed = "11111111-1111-4111-8111-1111111111c5";
const sydney = "22222222-2222-4222-8222-2222222222c1";
const losAngeles = "22222222-2222-4222-8222-2222222222c2";
const unknownZone = "22222222-2222-4222-8222-2222222222c3";

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
       ($1,'owner@test.invalid'), ($2,'colleague@test.invalid'), ($3,'outsider@test.invalid'),
       ($4,'leaver@test.invalid'), ($5,'closed@test.invalid')`,
    [owner, colleague, outsider, leaver, closed],
  );
  await db.query(
    `insert into workspaces(id,name,slug,owner_user_id,timezone) values
       ($1,'Sydney Co','briefing-sydney',$4,'Australia/Sydney'),
       ($2,'LA Co','briefing-la',$4,'America/Los_Angeles'),
       ($3,'Typo Co','briefing-typo',$4,'Not/AZone')`,
    [sydney, losAngeles, unknownZone, owner],
  );
  await db.query(
    `insert into workspace_members(workspace_id,user_id,role) values
       ($1,$3,'owner'), ($1,$4,'employee'), ($1,$5,'manager'), ($1,$6,'accountant'),
       ($2,$3,'owner')`,
    [sydney, losAngeles, owner, colleague, leaver, closed],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

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

type Facts = {
  invoices: {
    overdueCount: number;
    overdueCents: number;
    dueSoonCount: number;
    dueSoonCents: number;
    draftCount: number;
  } | null;
  quotes: {
    acceptedCount: number;
    acceptedCents: number;
    expiringCount: number;
    expiringCents: number;
  } | null;
};

async function facts(
  workspaceId: string,
  today: string,
  include: { invoices?: boolean; quotes?: boolean } = {},
): Promise<Facts> {
  const { rows } = await db.query<{ facts: Facts }>(
    "select public.get_insight_facts($1, $2::date, $3, $4) as facts",
    [workspaceId, today, include.invoices ?? true, include.quotes ?? true],
  );
  return rows[0]!.facts;
}

type Claim = {
  workspaceId: string;
  userId: string;
  frequency: string;
  period: string;
  previousPeriod: string | null;
  role: string;
  email: string;
};

async function claim(now: string, limit?: number): Promise<Claim[]> {
  const { rows } = await db.query<{ claims: Claim[] }>(
    limit === undefined
      ? "select public.claim_ai_digests($1::timestamptz) as claims"
      : "select public.claim_ai_digests($1::timestamptz, $2) as claims",
    limit === undefined ? [now] : [now, limit],
  );
  return rows[0]!.claims;
}

async function setFrequency(
  workspaceId: string,
  userId: string,
  frequency: "off" | "daily" | "weekly",
): Promise<void> {
  await db.query(
    `insert into ai_digest_preferences(workspace_id,user_id,frequency) values ($1,$2,$3)
     on conflict (workspace_id,user_id) do update set frequency = excluded.frequency`,
    [workspaceId, userId, frequency],
  );
}

describe.sequential("briefing facts on PostgreSQL", () => {
  it("counts overdue, due-soon and draft invoices by status and due date", async () => {
    await db.query(
      `insert into invoices(workspace_id,number,status,due_date,total_cents) values
         ($1,'F-1','overdue','2026-11-01',10000),
         ($1,'F-2','overdue','2026-11-10',25050),
         ($1,'F-3','sent','2026-11-19',5000),
         ($1,'F-4','viewed','2026-11-26',7000),
         ($1,'F-5','sent','2026-11-27',900),
         ($1,'F-6','sent','2026-11-18',800),
         ($1,'F-7','sent',null,700),
         ($1,'F-8','paid','2026-11-20',600),
         ($1,'F-9','void','2026-11-20',500),
         ($1,'F-10','draft','2026-11-20',400),
         ($1,'F-11','draft',null,300),
         ($2,'F-1','overdue','2026-11-01',99999),
         ($2,'F-2','sent','2026-11-20',88888)`,
      [sydney, losAngeles],
    );
    // 19 Nov: due on the day and up to 26 Nov count; the 27th, yesterday's still-unflagged
    // invoice, undated, paid, void and draft invoices do not.
    expect((await facts(sydney, "2026-11-19")).invoices).toEqual({
      overdueCount: 2,
      overdueCents: 35050,
      dueSoonCount: 2,
      dueSoonCents: 12000,
      draftCount: 2,
    });
  });

  it("moves the due-soon window with the local date it is given", async () => {
    // One day earlier the invoice due on the 18th is in, and the one due on the 26th is out.
    expect((await facts(sydney, "2026-11-18")).invoices).toMatchObject({
      dueSoonCount: 2,
      dueSoonCents: 5800,
    });
    // One day later the 27th comes into range and the 19th has passed.
    expect((await facts(sydney, "2026-11-20")).invoices).toMatchObject({
      dueSoonCount: 2,
      dueSoonCents: 7900,
    });
  });

  it("counts accepted quotes and quotes expiring soon", async () => {
    await db.query(
      `insert into quotes(workspace_id,number,status,valid_until,total_cents) values
         ($1,'Q-1','accepted','2026-11-01',40000),
         ($1,'Q-2','accepted',null,2500),
         ($1,'Q-3','sent','2026-11-19',1000),
         ($1,'Q-4','viewed','2026-11-26',2000),
         ($1,'Q-5','sent','2026-11-27',3000),
         ($1,'Q-6','draft','2026-11-20',4000),
         ($1,'Q-7','expired','2026-11-20',5000),
         ($1,'Q-8','converted','2026-11-20',6000),
         ($1,'Q-9','declined','2026-11-20',7000),
         ($2,'Q-1','accepted','2026-11-20',77777)`,
      [sydney, losAngeles],
    );
    expect((await facts(sydney, "2026-11-19")).quotes).toEqual({
      acceptedCount: 2,
      acceptedCents: 42500,
      expiringCount: 2,
      expiringCents: 3000,
    });
  });

  it("agrees with the dashboard summary functions on overdue, draft and accepted", async () => {
    const { rows } = await db.query<{
      invoices: { overdueCount: number; overdueCents: number; draftCount: number };
      quotes: { readyCount: number; acceptedValueCents: number };
    }>(
      `select public.get_invoice_dashboard_summary($1) as invoices,
              public.get_quote_dashboard_summary($1) as quotes`,
      [sydney],
    );
    const insight = await facts(sydney, "2026-11-19");
    expect(insight.invoices).toMatchObject({
      overdueCount: rows[0]!.invoices.overdueCount,
      overdueCents: rows[0]!.invoices.overdueCents,
      draftCount: rows[0]!.invoices.draftCount,
    });
    expect(insight.quotes).toMatchObject({
      acceptedCount: rows[0]!.quotes.readyCount,
      acceptedCents: rows[0]!.quotes.acceptedValueCents,
    });
  });

  it("leaves out a section the member may not see, and reads only the workspace asked for", async () => {
    expect(await facts(sydney, "2026-11-19", { invoices: false })).toMatchObject({
      invoices: null,
      quotes: { acceptedCount: 2 },
    });
    expect(await facts(sydney, "2026-11-19", { quotes: false })).toMatchObject({
      invoices: { overdueCount: 2 },
      quotes: null,
    });
    expect(await facts(losAngeles, "2026-11-19")).toEqual({
      invoices: {
        overdueCount: 1,
        overdueCents: 99999,
        dueSoonCount: 1,
        dueSoonCents: 88888,
        draftCount: 0,
      },
      quotes: { acceptedCount: 1, acceptedCents: 77777, expiringCount: 0, expiringCents: 0 },
    });
    expect(await facts(unknownZone, "2026-11-19")).toEqual({
      invoices: {
        overdueCount: 0,
        overdueCents: 0,
        dueSoonCount: 0,
        dueSoonCents: 0,
        draftCount: 0,
      },
      quotes: { acceptedCount: 0, acceptedCents: 0, expiringCount: 0, expiringCents: 0 },
    });
  });
});

describe.sequential("digest preference access on PostgreSQL", () => {
  it("lets a member read their own choice and nobody else's", async () => {
    await setFrequency(sydney, owner, "weekly");
    const visible = (userId: string) =>
      asUser(userId, async () => {
        const { rows } = await db.query<{ user_id: string; frequency: string }>(
          "select user_id, frequency from ai_digest_preferences where workspace_id = $1",
          [sydney],
        );
        return rows;
      });
    expect(await visible(owner)).toEqual([{ user_id: owner, frequency: "weekly" }]);
    expect(await visible(colleague)).toEqual([]);
    expect(await visible(outsider)).toEqual([]);
  });

  it("gives a signed-in session no way to write, even to its own row", async () => {
    // The app saves the choice through the service role after checking who is asking, as
    // it does for every other table; a browser session cannot write here directly.
    await expect(
      asUser(colleague, () =>
        db.query(
          "insert into ai_digest_preferences(workspace_id,user_id,frequency) values ($1,$2,'daily')",
          [sydney, colleague],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () =>
        db.query(
          "update ai_digest_preferences set frequency = 'off' where workspace_id = $1 and user_id = $2",
          [sydney, owner],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    // So nobody can ask for a second send by rewinding the sent marker, or remove the row.
    await expect(
      asUser(owner, () =>
        db.query(
          "update ai_digest_preferences set last_period = null where workspace_id = $1 and user_id = $2",
          [sydney, owner],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(owner, () =>
        db.query("delete from ai_digest_preferences where workspace_id = $1 and user_id = $2", [
          sydney,
          owner,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("rejects a frequency that does not exist and defaults to off", async () => {
    await expect(
      db.query(
        "insert into ai_digest_preferences(workspace_id,user_id,frequency) values ($1,$2,'hourly')",
        [sydney, colleague],
      ),
    ).rejects.toThrow();
    const { rows } = await db.query<{ frequency: string; last_period: string | null }>(
      `insert into ai_digest_preferences(workspace_id,user_id) values ($1,$2)
       returning frequency, last_period::text`,
      [sydney, colleague],
    );
    expect(rows[0]).toEqual({ frequency: "off", last_period: null });
  });
});

describe.sequential("digest claim on PostgreSQL", () => {
  beforeAll(async () => {
    await db.exec("delete from ai_digest_preferences");
  });

  it("returns nobody when nobody has opted in", async () => {
    await setFrequency(sydney, colleague, "off");
    expect(await claim("2026-11-19T02:00:00Z")).toEqual([]);
  });

  it("waits for 07:00 in the workspace's timezone", async () => {
    await setFrequency(sydney, owner, "daily");
    // 19:30 UTC on the 18th is 06:30 on the 19th in Sydney (UTC+11 in November).
    expect(await claim("2026-11-18T19:30:00Z")).toEqual([]);
    // 20:07 UTC is 07:07 in Sydney: due, for Sydney's date rather than the UTC date.
    expect(await claim("2026-11-18T20:07:00Z")).toEqual([
      {
        workspaceId: sydney,
        userId: owner,
        frequency: "daily",
        period: "2026-11-19",
        previousPeriod: null,
        role: "owner",
        email: "owner@test.invalid",
      },
    ]);
  });

  it("returns nobody on a second run in the same period", async () => {
    // The same minute again, as a retried or duplicated cron delivery would be.
    expect(await claim("2026-11-18T20:07:00Z")).toEqual([]);
    // Every later hourly run that local day.
    expect(await claim("2026-11-18T21:07:00Z")).toEqual([]);
    expect(await claim("2026-11-19T12:59:00Z")).toEqual([]);
  });

  it("claims a daily member again on the next local day, after 07:00", async () => {
    // 13:30 UTC on the 19th is 00:30 on the 20th in Sydney: a new day, but before 07:00.
    expect(await claim("2026-11-19T13:30:00Z")).toEqual([]);
    const next = await claim("2026-11-19T20:07:00Z");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ period: "2026-11-20", previousPeriod: "2026-11-19" });
  });

  it("claims a weekly member on Monday only, once for the week", async () => {
    await db.exec("delete from ai_digest_preferences");
    await setFrequency(sydney, owner, "weekly");
    // Thursday 19 to Sunday 22 November 2026 in Sydney, each at 09:00 local.
    for (const day of ["18", "19", "20", "21"]) {
      expect(await claim(`2026-11-${day}T22:00:00Z`)).toEqual([]);
    }
    // Monday 23 November: not before 07:00, then once.
    expect(await claim("2026-11-22T19:59:00Z")).toEqual([]);
    const monday = await claim("2026-11-22T20:07:00Z");
    expect(monday).toHaveLength(1);
    expect(monday[0]).toMatchObject({ frequency: "weekly", period: "2026-11-23" });
    expect(await claim("2026-11-22T21:07:00Z")).toEqual([]);
    // Tuesday to Sunday of the same week, then the following Monday.
    for (const day of ["23", "24", "25", "26", "27", "28"]) {
      expect(await claim(`2026-11-${day}T22:00:00Z`)).toEqual([]);
    }
    const nextMonday = await claim("2026-11-29T20:07:00Z");
    expect(nextMonday).toHaveLength(1);
    expect(nextMonday[0]).toMatchObject({ period: "2026-11-30", previousPeriod: "2026-11-23" });
  });

  it("uses each workspace's own clock for the same member", async () => {
    await db.exec("delete from ai_digest_preferences");
    await setFrequency(sydney, owner, "daily");
    await setFrequency(losAngeles, owner, "daily");
    // 20:07 UTC on the 18th: 07:07 on the 19th in Sydney, 12:07 on the 18th in Los Angeles.
    const first = await claim("2026-11-18T20:07:00Z");
    expect(first.map((row) => [row.workspaceId, row.period])).toEqual([
      [sydney, "2026-11-19"],
      [losAngeles, "2026-11-18"],
    ]);
    // 08:07 UTC on the 19th: still the 19th in Sydney, but 00:07 on the 19th in Los Angeles.
    expect(await claim("2026-11-19T08:07:00Z")).toEqual([]);
    // 15:07 UTC on the 19th is 07:07 in Los Angeles; Sydney is at 02:07 on the 20th.
    const second = await claim("2026-11-19T15:07:00Z");
    expect(second.map((row) => [row.workspaceId, row.period])).toEqual([
      [losAngeles, "2026-11-19"],
    ]);
  });

  it("falls back to UTC for a timezone PostgreSQL does not know", async () => {
    await db.exec("delete from ai_digest_preferences");
    await db.query(
      "insert into workspace_members(workspace_id,user_id,role) values ($1,$2,'owner')",
      [unknownZone, owner],
    );
    await setFrequency(unknownZone, owner, "daily");
    expect(await claim("2026-11-19T06:59:00Z")).toEqual([]);
    const due = await claim("2026-11-19T07:00:00Z");
    expect(due.map((row) => [row.workspaceId, row.period])).toEqual([[unknownZone, "2026-11-19"]]);
  });

  it("skips people who left, closed accounts and deleted workspaces", async () => {
    await db.exec("delete from ai_digest_preferences");
    await setFrequency(sydney, leaver, "daily");
    await setFrequency(sydney, closed, "daily");
    await setFrequency(sydney, outsider, "daily");
    await setFrequency(losAngeles, owner, "daily");
    await db.query(
      "update workspace_members set deleted_at = now() where workspace_id = $1 and user_id = $2",
      [sydney, leaver],
    );
    await db.query("update users set deleted_at = now() where id = $1", [closed]);
    await db.query("update workspaces set deleted_at = now() where id = $1", [losAngeles]);
    try {
      // 22:00 UTC is past 07:00 in both Sydney and Los Angeles.
      expect(await claim("2026-11-19T22:00:00Z")).toEqual([]);
      const { rows } = await db.query<{ claimed: number }>(
        "select count(*)::int as claimed from ai_digest_preferences where last_period is not null",
      );
      expect(rows[0]!.claimed).toBe(0);
    } finally {
      await db.query(
        "update workspace_members set deleted_at = null where workspace_id = $1 and user_id = $2",
        [sydney, leaver],
      );
      await db.query("update users set deleted_at = null where id = $1", [closed]);
      await db.query("update workspaces set deleted_at = null where id = $1", [losAngeles]);
    }
  });

  it("claims at most the limit per call and leaves the rest due", async () => {
    await db.exec("delete from ai_digest_preferences");
    for (const user of [owner, colleague, leaver, closed]) {
      await setFrequency(sydney, user, "daily");
    }
    const first = await claim("2026-11-19T22:00:00Z", 3);
    const second = await claim("2026-11-19T22:00:00Z", 3);
    const third = await claim("2026-11-19T22:00:00Z", 3);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(1);
    expect(third).toEqual([]);
    const claimed = [...first, ...second].map((row) => row.userId).sort();
    expect(claimed).toEqual([owner, colleague, leaver, closed].sort());
    // Each claim carries the member's role, which decides what their digest may contain.
    expect(Object.fromEntries([...first, ...second].map((row) => [row.userId, row.role]))).toEqual({
      [owner]: "owner",
      [colleague]: "employee",
      [leaver]: "manager",
      [closed]: "accountant",
    });
  });

  it("can hand a claim back only while it is still the current one", async () => {
    // The job releases a claim when it failed before anything was sent, so the next run
    // retries. The release is conditional on the period it claimed.
    const release = async (period: string, previous: string | null) =>
      (
        await db.query(
          `update ai_digest_preferences set last_period = $3::date
           where workspace_id = $1 and user_id = $2 and last_period = $4::date`,
          [sydney, owner, previous, period],
        )
      ).affectedRows ?? 0;
    expect(await release("2026-11-19", null)).toBe(0);
    expect(await release("2026-11-20", null)).toBe(1);
    const again = await claim("2026-11-19T22:30:00Z");
    expect(again.map((row) => row.userId)).toEqual([owner]);
  });

  it("stops when a member turns the digest off", async () => {
    await setFrequency(sydney, owner, "off");
    await setFrequency(sydney, colleague, "off");
    await setFrequency(sydney, leaver, "off");
    await setFrequency(sydney, closed, "off");
    expect(await claim("2026-11-20T22:00:00Z")).toEqual([]);
    // Turning it back on does not forget what was already sent that day.
    await db.query("update ai_digest_preferences set last_period = '2026-11-21'");
    await setFrequency(sydney, owner, "daily");
    expect(await claim("2026-11-20T22:00:00Z")).toEqual([]);
  });

  it("exposes the functions to the service role only", async () => {
    const { rows } = await db.query<{
      role: string;
      facts: boolean;
      claim: boolean;
      clock: boolean;
    }>(
      `select r.role,
         has_function_privilege(r.role, 'public.get_insight_facts(uuid, date, boolean, boolean, integer)', 'execute') as facts,
         has_function_privilege(r.role, 'public.claim_ai_digests(timestamptz, integer)', 'execute') as claim,
         has_function_privilege(r.role, 'public.ai_digest_local_time(timestamptz, text)', 'execute') as clock
       from (values ('anon'), ('authenticated'), ('service_role')) as r(role)
       order by r.role`,
    );
    expect(rows).toEqual([
      { role: "anon", facts: false, claim: false, clock: false },
      { role: "authenticated", facts: false, claim: false, clock: false },
      { role: "service_role", facts: true, claim: true, clock: true },
    ]);
  });
});
