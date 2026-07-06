import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  auditLogs,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceInvitations,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus } from "@/server/events";
import {
  acceptInvitation,
  getInvitationByToken,
  inviteMember,
  resendInvitation,
  revokeInvitation,
} from "./index";

/**
 * Wave 4 Part A integration: the full invitation lifecycle — invite → get-by-token →
 * resend → revoke, plus the accept path (new user joins). DB-gated (skips without DATABASE_URL).
 * UUID suffixes `...0000e1`/`...0000e2` are unique to this file.
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("member invitations lifecycle (requires DATABASE_URL)", () => {
  const owner = branded<"UserId">("00000000-0000-4000-8000-0000000000e1");
  const invitee = branded<"UserId">("00000000-0000-4000-8000-0000000000e2");
  const inviteeEmail = "invitee-e2@soletrade-test.local";
  let ws: WorkspaceId;
  const createdInvitationIds: string[] = [];

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values([
      { id: owner, email: "invite-owner@soletrade-test.local", fullName: "Invite Owner" },
      { id: invitee, email: inviteeEmail, fullName: "Invitee Two" },
    ]);
    ws = await createWorkspace(owner, "Invite Test", `invite-test-${Date.now()}`);
  });

  afterEach(() => clearEventBus());

  afterAll(async () => {
    const db = getDb();
    if (!ws) return;
    await db.delete(workspaceInvitations).where(eq(workspaceInvitations.workspaceId, ws));
    await db.delete(auditLogs).where(eq(auditLogs.workspaceId, ws));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws));
    await db.delete(workspacesTable).where(eq(workspacesTable.id, ws));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner, invitee]));
  });

  it("invite → getInvitationByToken → resend → revoke", async () => {
    const result = await inviteMember(ws!, inviteeEmail, "manager", owner);
    createdInvitationIds.push(result.invitationId);
    expect(result.token).toBeTruthy();
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // getInvitationByToken resolves the invitation + workspace name + not-yet-expired flag.
    const inv = await getInvitationByToken(result.token);
    expect(inv).not.toBeNull();
    expect(inv!.email).toBe(inviteeEmail);
    expect(inv!.role).toBe("manager");
    expect(inv!.status).toBe("pending");
    expect(inv!.expired).toBe(false);
    expect(inv!.workspaceName).toBe("Invite Test");

    // Resend bumps the expiry + re-publishes MemberInvited; token is preserved.
    const before = result.expiresAt.getTime();
    const resent = await resendInvitation(ws!, result.invitationId, owner);
    expect(resent).not.toBeNull();
    expect(resent!.token).toBe(result.token);
    expect(resent!.expiresAt.getTime()).toBeGreaterThan(before);

    // Revoke marks the row revoked; getInvitationByToken still returns it (status !== pending).
    await revokeInvitation(ws!, result.invitationId, owner);
    const afterRevoke = await getInvitationByToken(result.token);
    expect(afterRevoke).not.toBeNull();
    expect(afterRevoke!.status).toBe("revoked");
  });

  it("acceptInvitation joins the user to the workspace + marks the invitation accepted", async () => {
    const result = await inviteMember(ws!, inviteeEmail, "accountant", owner);
    createdInvitationIds.push(result.invitationId);

    const joinedWs = await acceptInvitation(result.token, invitee, inviteeEmail);
    expect(joinedWs).toBe(ws!);

    // The invitee is now a member with the offered role.
    const db = getDb();
    const memberRows = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, invitee))
      .limit(1);
    expect(memberRows[0]?.role).toBe("accountant");

    // Re-accepting the same token fails (already accepted).
    await expect(acceptInvitation(result.token, invitee, inviteeEmail)).rejects.toThrow(
      /not found or already used/i,
    );
  });

  it("getInvitationByToken returns null for an unknown token", async () => {
    expect(await getInvitationByToken("does-not-exist")).toBeNull();
  });

  it("resendInvitation returns null for a non-pending (revoked) invitation", async () => {
    const result = await inviteMember(ws!, inviteeEmail, "employee", owner);
    createdInvitationIds.push(result.invitationId);
    await revokeInvitation(ws!, result.invitationId, owner);
    expect(await resendInvitation(ws!, result.invitationId, owner)).toBeNull();
  });
});
