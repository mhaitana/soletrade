import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrapVoid } from "@/server/infrastructure/db/helpers";
import { cleanupWorkspaces, seedUsers } from "@/testing/db-helpers";
import { branded, type WorkspaceId } from "@/types/ids";
import { createWorkspace } from "@/server/foundation/workspaces";
import { clearEventBus, publishEvent } from "@/server/infrastructure/events";
import { registerNotifications } from "@/server/application/notifications";
import {
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  memberIdsWithPermission,
  unreadCount,
} from "@/server/foundation/notifications/store";

/**
 * Integration tests for the in-app notification store + event-bus fan-out against a
 * real Postgres.
 *
 * Run ONLY when DATABASE_URL is set; otherwise `pnpm test:ci` skips this file:
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * UUID suffixes `...0000f3`/`...0000f7`/`...0000f8` are unique to this file (f1 is used by
 * the workspace-settings test and f2 by the books/tax test - sharing them caused cross-file
 * FK collisions under parallel execution, so this file moved off them).
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("notifications integration (requires DATABASE_URL)", () => {
  const owner = branded<"UserId">("00000000-0000-4000-8000-0000000000f7");
  const employee = branded<"UserId">("00000000-0000-4000-8000-0000000000f8");
  const otherOwner = branded<"UserId">("00000000-0000-4000-8000-0000000000f3");
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  let unsub: (() => void) | null = null;

  beforeAll(async () => {
    await seedUsers([
      { id: owner, email: "notif-owner@soletrade-test.local", fullName: "Notif Owner" },
      { id: employee, email: "notif-emp@soletrade-test.local", fullName: "Notif Employee" },
      { id: otherOwner, email: "notif-other@soletrade-test.local", fullName: "Notif Other" },
    ]);
    ws1 = await createWorkspace(owner, "Notif Test One", `notif-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherOwner, "Notif Test Two", `notif-test-two-${Date.now()}`);
    // Add an employee to ws1 (createWorkspace only adds the owner).
    await unwrapVoid(
      getDataClient()
        .from("workspace_members")
        .insert([{ workspace_id: ws1, user_id: employee, role: "employee" }]),
    );
    unsub = registerNotifications();
  });

  afterAll(async () => {
    unsub?.();
    clearEventBus();
    const workspaceIds = [ws1, ws2].filter(Boolean) as WorkspaceId[];
    // The helper deletes users even when workspaceIds is empty, covering the
    // original no-workspace branch that deleted only the users.
    await cleanupWorkspaces(
      workspaceIds,
      [owner, employee, otherOwner],
      [{ table: "mobile_notification_outbox" }, { table: "notifications" }],
    );
  });

  it("memberIdsWithPermission resolves only members whose role grants it", async () => {
    // view:audit is granted to owner/admin/accountant - not employee.
    const withAudit = await memberIdsWithPermission(ws1!, "view:audit");
    expect(withAudit).toContain(owner);
    expect(withAudit).not.toContain(employee);
    // view:quote is granted to every role (employee via create:quote → view:quote).
    const withQuote = await memberIdsWithPermission(ws1!, "view:quote");
    expect(withQuote).toContain(owner);
    expect(withQuote).toContain(employee);
  });

  it("createNotification + listNotifications scope to workspace AND user (no IDOR)", async () => {
    await createNotification({
      workspaceId: ws1!,
      userId: owner,
      type: "invoice.paid",
      title: "INV-1 paid",
      entityType: "invoice",
      entityId: "00000000-0000-4000-8000-0000000000f4",
    });
    // Owner sees it; employee (same workspace, different user) does not.
    const ownerList = await listNotifications(ws1!, owner, { limit: 100 });
    const empList = await listNotifications(ws1!, employee, { limit: 100 });
    expect(ownerList.items.some((n) => n.title === "INV-1 paid")).toBe(true);
    expect(empList.items.some((n) => n.title === "INV-1 paid")).toBe(false);
    // Cross-workspace: owner has no rows in ws2.
    const ws2List = await listNotifications(ws2!, owner, { limit: 100 });
    expect(ws2List.items.some((n) => n.title === "INV-1 paid")).toBe(false);
  });

  it("unreadCount + markRead update the bell badge", async () => {
    const before = await unreadCount(ws1!, owner);
    await createNotification({
      workspaceId: ws1!,
      userId: owner,
      type: "quote.accepted",
      title: "QUO-1 accepted",
    });
    const after = await unreadCount(ws1!, owner);
    expect(after).toBe(before + 1);

    // Mark the new one read via listNotifications → markRead.
    const list = await listNotifications(ws1!, owner, { unreadOnly: true, limit: 100 });
    const target = list.items.find((n) => n.title === "QUO-1 accepted");
    expect(target).toBeDefined();
    const changed = await markRead(ws1!, owner, target!.id);
    expect(changed).toBe(true);
    // Idempotent: second markRead on the same row is a no-op (readAt already set).
    const again = await markRead(ws1!, owner, target!.id);
    expect(again).toBe(false);
  });

  it("markRead is user-scoped (a cross-user id is a no-op)", async () => {
    const ownerList = await listNotifications(ws1!, owner, { limit: 100 });
    const ownerNotif = ownerList.items[0]!;
    const cross = await markRead(ws1!, employee, ownerNotif.id);
    expect(cross).toBe(false);
  });

  it("markAllRead clears every unread row for the user (and only the user)", async () => {
    await createNotification({ workspaceId: ws1!, userId: owner, type: "t", title: "bulk-1" });
    await createNotification({ workspaceId: ws1!, userId: owner, type: "t", title: "bulk-2" });
    const before = await unreadCount(ws1!, owner);
    expect(before).toBeGreaterThanOrEqual(2);
    const n = await markAllRead(ws1!, owner);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(await unreadCount(ws1!, owner)).toBe(0);
  });

  it("event-bus fan-out: QuoteAccepted creates one in-app row per qualifying member", async () => {
    const beforeOwner = (await listNotifications(ws1!, owner, { limit: 200 })).items.length;
    const beforeEmp = (await listNotifications(ws1!, employee, { limit: 200 })).items.length;

    await publishEvent({
      type: "QuoteAccepted",
      workspaceId: ws1!,
      actorUserId: undefined,
      entityType: "quote",
      entityId: "00000000-0000-4000-8000-0000000000f5",
      metadata: {
        number: "QUO-2026-099",
        totalCents: 15000,
        currency: "AUD",
        customerName: "Acme",
      },
    });

    // Both ws1 members (owner + employee) hold view:quote → both get a row.
    const ownerAfter = (await listNotifications(ws1!, owner, { limit: 200 })).items.length;
    const empAfter = (await listNotifications(ws1!, employee, { limit: 200 })).items.length;
    expect(ownerAfter).toBe(beforeOwner + 1);
    expect(empAfter).toBe(beforeEmp + 1);

    // ws2 owner gets nothing (cross-workspace isolation).
    const ws2After = (await listNotifications(ws2!, otherOwner, { limit: 200 })).items.length;
    expect(ws2After).toBe(0);

    // The row carries the type + entity link.
    const ownerList = await listNotifications(ws1!, owner, { limit: 200 });
    const row = ownerList.items.find((n) => n.type === "quote.accepted");
    expect(row?.entityType).toBe("quote");
    expect(row?.entityId).toBe("00000000-0000-4000-8000-0000000000f5");
  });

  it("event-bus fan-out: QuoteExpired (metadata has only number) still creates a row", async () => {
    const before = (await listNotifications(ws1!, owner, { limit: 200 })).items.length;
    await publishEvent({
      type: "QuoteExpired",
      workspaceId: ws1!,
      entityType: "quote",
      entityId: "00000000-0000-4000-8000-0000000000f6",
      metadata: { number: "QUO-2026-100" },
    });
    const after = (await listNotifications(ws1!, owner, { limit: 200 })).items.length;
    expect(after).toBe(before + 1);
  });
});
