import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { listAudit, writeAudit } from "@/platform/audit";

/**
 * Integration tests for the audit read-side against a real Postgres.
 *
 * Run ONLY when DATABASE_URL is set; otherwise `pnpm test:ci` skips this file:
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * UUID suffixes `...0000d1`/`...0000d2` are unique to this file (grep before
 * adding a new integration test - a failed beforeAll leaves orphaned rows; run
 * `pnpm db:reset` to recover).
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("audit integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-4000-8000-0000000000d1");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-0000000000d2");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "audit-actor@soletrade-test.local", fullName: "Audit Actor" },
      { id: otherActor, email: "audit-other@soletrade-test.local", fullName: "Audit Other" },
    ]);
    ws1 = await createWorkspace(actor, "Audit Test One", `audit-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Audit Test Two", `audit-test-two-${Date.now()}`);

    // Seed ws1 with four audit entries across two prefixes + one system row.
    await writeAudit({
      workspaceId: ws1,
      actorUserId: actor,
      action: "member.invite",
      targetType: "member",
      targetId: "inv-1",
      metadata: { role: "admin" },
    });
    await writeAudit({
      workspaceId: ws1,
      actorUserId: actor,
      action: "member.remove",
      targetType: "member",
      targetId: "usr-1",
    });
    await writeAudit({
      workspaceId: ws1,
      actorUserId: actor,
      action: "billing.subscription.update",
      targetType: "subscription",
      targetId: "sub-1",
    });
    await writeAudit({
      workspaceId: ws1,
      action: "authz.denied",
      metadata: { reason: "no grant" },
      ip: "203.0.113.7",
    });
    // ws2 row that must never appear in ws1 listings.
    await writeAudit({
      workspaceId: ws2,
      actorUserId: otherActor,
      action: "member.invite",
      targetType: "member",
      targetId: "inv-other",
    });
  });

  afterAll(async () => {
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(workspaceIds, [actor, otherActor], [{ table: "audit_logs" }]);
  });

  it("lists workspace entries newest-first and isolates per workspace (no IDOR)", async () => {
    const { items } = await listAudit(ws1!, { limit: 100 });
    // Bootstrap (createWorkspace) writes a `workspace.create` row, so expect
    // the 4 seeded entries plus at least that one.
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.every((i) => i.workspaceId === ws1)).toBe(true);
    // All four seeded actions are present.
    const actions = items.map((i) => i.action);
    for (const seeded of [
      "member.invite",
      "member.remove",
      "billing.subscription.update",
      "authz.denied",
    ]) {
      expect(actions).toContain(seeded);
    }
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      expect(prev.createdAt.getTime()).toBeGreaterThanOrEqual(cur.createdAt.getTime());
    }
  });

  it("enriches actor name via the users join, and yields null for system rows", async () => {
    const { items } = await listAudit(ws1!, { limit: 100 });
    const actorRows = items.filter((i) => i.action !== "authz.denied");
    expect(actorRows.every((i) => i.actorFullName === "Audit Actor")).toBe(true);
    const systemRow = items.find((i) => i.action === "authz.denied");
    expect(systemRow?.actorUserId).toBeNull();
    expect(systemRow?.actorFullName).toBeNull();
    expect(systemRow?.ip).toBe("203.0.113.7");
  });

  it("filters by action prefix (category)", async () => {
    const { items } = await listAudit(ws1!, { actionPrefix: "member.", limit: 100 });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.action.startsWith("member."))).toBe(true);
  });

  it("filters by target type", async () => {
    const { items } = await listAudit(ws1!, { targetType: "subscription", limit: 100 });
    expect(items).toHaveLength(1);
    expect(items[0]?.action).toBe("billing.subscription.update");
  });

  it("paginates with a keyset cursor and yields no overlapping rows", async () => {
    const first = await listAudit(ws1!, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAudit(ws1!, { limit: 2, before: first.nextCursor! });
    expect(second.items).toHaveLength(2);

    const firstIds = new Set(first.items.map((i) => i.id));
    expect(second.items.every((i) => !firstIds.has(i.id))).toBe(true);
    expect(firstIds.size + second.items.length).toBe(4);
  });

  it("does not leak ws2 entries into a ws1 listing", async () => {
    const { items } = await listAudit(ws1!, { limit: 100 });
    expect(items.find((i) => i.targetId === "inv-other")).toBeUndefined();
  });
});
