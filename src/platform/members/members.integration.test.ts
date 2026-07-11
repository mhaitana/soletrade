import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/db/client";
import { unwrap, unwrapVoid } from "@/server/db/helpers";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus, onEvent } from "@/server/events";
import { listMembers, updateMemberRole } from "./index";

/**
 * Integration tests for `updateMemberRole` DB-backed guards + happy path.
 *
 * Run ONLY when DATABASE_URL is set; otherwise `pnpm test:ci` skips this file:
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * UUID suffixes `...0000d3`/`...0000d4`/`...0000d5` are unique to this file.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("updateMemberRole integration (requires DATABASE_URL)", () => {
  const owner = branded<"UserId">("00000000-0000-4000-8000-0000000000d3");
  const admin = branded<"UserId">("00000000-0000-4000-8000-0000000000d4");
  const employee = branded<"UserId">("00000000-0000-4000-8000-0000000000d5");
  let ws: WorkspaceId;

  beforeAll(async () => {
    await seedUsers([
      { id: owner, email: "role-owner@soletrade-test.local", fullName: "Role Owner" },
      { id: admin, email: "role-admin@soletrade-test.local", fullName: "Role Admin" },
      { id: employee, email: "role-emp@soletrade-test.local", fullName: "Role Employee" },
    ]);
    ws = await createWorkspace(owner, "Role Test", `role-test-${Date.now()}`);
    // Add an admin + an employee directly (createWorkspace only adds the owner).
    await unwrapVoid(
      getDataClient()
        .from("workspace_members")
        .insert([
          { workspace_id: ws, user_id: admin, role: "admin" },
          { workspace_id: ws, user_id: employee, role: "employee" },
        ]),
    );
  });

  afterEach(() => clearEventBus());

  afterAll(async () => {
    await cleanupWorkspaces(ws ? [ws] : [], [owner, admin, employee], [{ table: "audit_logs" }]);
  });

  it("refuses to change the owner's role", async () => {
    await expect(updateMemberRole(ws!, owner, "admin", admin)).rejects.toThrow(/owner's role/);
  });

  it("allows demotion when another owner/admin remains (owner is always present)", async () => {
    // The workspace has owner + admin + employee. The last-admin guard refuses
    // a demotion that would leave zero owner/admin — but every workspace has an
    // immovable owner, so the guard only bites once ownership transfer exists.
    // Here we assert the allow path: demote admin → employee (owner remains).
    await expect(updateMemberRole(ws!, admin, "employee", owner)).resolves.toBeUndefined();
    // Promote employee → admin, then demote them again — still allowed.
    await expect(updateMemberRole(ws!, employee, "admin", owner)).resolves.toBeUndefined();
    await expect(updateMemberRole(ws!, employee, "readonly", owner)).resolves.toBeUndefined();
  });

  it("refuses when the target is not an active member", async () => {
    const stranger = branded<"UserId">("00000000-0000-4000-8000-0000000000d6");
    await expect(updateMemberRole(ws!, stranger, "admin", owner)).rejects.toThrow(
      /isn't an active member/,
    );
  });

  it("happy path: changes role, writes audit, publishes MemberRoleChanged", async () => {
    let eventSeen = false;
    const off = onEvent("MemberRoleChanged", (e) => {
      if (e.workspaceId === ws) eventSeen = true;
    });
    try {
      // Promote employee (currently readonly after the previous test) → accountant.
      await updateMemberRole(ws!, employee, "accountant", owner);

      const members = await listMembers(ws!);
      const target = members.find((m) => m.userId === employee);
      expect(target?.role).toBe("accountant");

      // Audit row written with from/to. Order desc so [0] is the happy-path
      // row (earlier tests in this file also write member.role.change rows).
      const auditRows = await unwrap(
        getDataClient()
          .from("audit_logs")
          .select("metadata")
          .eq("workspace_id", ws!)
          .eq("target_id", employee)
          .eq("action", "member.role.change")
          .order("created_at", { ascending: false }),
      );
      expect(auditRows.length).toBeGreaterThan(0);
      const meta = auditRows[0]?.metadata as { from?: string; to?: string } | null;
      expect(meta?.to).toBe("accountant");

      expect(eventSeen).toBe(true);
    } finally {
      off();
    }
  });
});
