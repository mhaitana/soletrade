import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus, publishEvent, setEventPersister } from "@/server/events";
import { listActivity, writeActivity } from "@/platform/activity";

/**
 * Integration tests for the activity read-side against a real Postgres.
 *
 * Run ONLY when DATABASE_URL is set; otherwise `pnpm test:ci` skips this file:
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("activity integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-4000-8000-000000000010");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-000000000011");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;

  beforeAll(async () => {
    await seedUsers([
      { id: actor, email: "activity-actor@soletrade-test.local", fullName: "Test Actor" },
      { id: otherActor, email: "activity-other@soletrade-test.local", fullName: "Test Other" },
    ]);
    ws1 = await createWorkspace(actor, "Activity Test One", `activity-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Activity Test Two", `activity-test-two-${Date.now()}`);

    // Seed ws1 with four events; one has no actor (System).
    await writeActivity({
      type: "CustomerCreated",
      workspaceId: ws1,
      actorUserId: actor,
      entityType: "customer",
      entityId: "cust-1",
      metadata: { name: "Jane" },
    });
    await writeActivity({
      type: "CustomerUpdated",
      workspaceId: ws1,
      actorUserId: actor,
      entityType: "customer",
      entityId: "cust-1",
    });
    await writeActivity({
      type: "CustomerDeleted",
      workspaceId: ws1,
      actorUserId: actor,
      entityType: "customer",
      entityId: "cust-1",
    });
    await writeActivity({
      type: "ModuleEnabled",
      workspaceId: ws1,
      entityType: "module",
      entityId: "invoices",
    });
    // Seed ws2 with one event that must never appear in ws1 listings.
    await writeActivity({
      type: "CustomerCreated",
      workspaceId: ws2,
      actorUserId: otherActor,
      entityType: "customer",
      entityId: "cust-other",
    });
  });

  afterEach(() => {
    clearEventBus();
  });

  afterAll(async () => {
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    await cleanupWorkspaces(
      workspaceIds,
      [actor, otherActor],
      [{ table: "activity_events" }, { table: "audit_logs" }],
    );
  });

  it("lists workspace events newest-first and isolates per workspace (no IDOR)", async () => {
    const { items } = await listActivity(ws1!, { limit: 100 });
    expect(items).toHaveLength(4);
    expect(items.every((i) => i.workspaceId === ws1)).toBe(true);
    // Ordering: newest first (createdAt desc, id desc tiebreaker).
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      expect(prev.createdAt.getTime()).toBeGreaterThanOrEqual(cur.createdAt.getTime());
    }
  });

  it("enriches actor name via the users join, and yields null for system events", async () => {
    const { items } = await listActivity(ws1!, { limit: 100 });
    const actorRows = items.filter((i) => i.type !== "ModuleEnabled");
    expect(actorRows.every((i) => i.actorFullName === "Test Actor")).toBe(true);
    const systemRow = items.find((i) => i.type === "ModuleEnabled");
    expect(systemRow?.actorUserId).toBeNull();
    expect(systemRow?.actorFullName).toBeNull();
  });

  it("filters by a set of types", async () => {
    const { items } = await listActivity(ws1!, { types: ["CustomerCreated"], limit: 100 });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("CustomerCreated");
    expect(items[0]?.metadata).toEqual({ name: "Jane" });
  });

  it("filters by entity type", async () => {
    const { items } = await listActivity(ws1!, { entityType: "customer", limit: 100 });
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.entityType === "customer")).toBe(true);
  });

  it("paginates with a keyset cursor and yields no overlapping rows", async () => {
    const first = await listActivity(ws1!, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listActivity(ws1!, { limit: 2, before: first.nextCursor! });
    expect(second.items).toHaveLength(2);

    const firstIds = new Set(first.items.map((i) => i.id));
    const secondIds = second.items.map((i) => i.id);
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);

    // Combined, the two pages cover all four ws1 events.
    expect(firstIds.size + secondIds.length).toBe(4);
  });

  it("does not leak ws2 events into a ws1 cursor page", async () => {
    const { items } = await listActivity(ws1!, { limit: 100 });
    expect(items.find((i) => i.entityId === "cust-other")).toBeUndefined();
  });

  it("end-to-end: publishEvent with a writeActivity persister creates a listable row", async () => {
    setEventPersister(async (event) => {
      await writeActivity({
        type: event.type,
        workspaceId: event.workspaceId,
        actorUserId: event.actorUserId,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata,
      });
    });
    await publishEvent({
      type: "CustomerCreated",
      workspaceId: ws1!,
      actorUserId: actor,
      entityType: "customer",
      entityId: "cust-bus",
      metadata: { name: "Bus-created customer" },
    });

    const { items } = await listActivity(ws1!, { types: ["CustomerCreated"], limit: 100 });
    expect(items.some((i) => i.entityId === "cust-bus")).toBe(true);
  });
});
