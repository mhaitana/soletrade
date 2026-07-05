import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  users as usersTable,
  workspaceMembers,
  workspaceInvitations,
  workspaces,
} from "@/server/db/schema";
import type { WorkspaceRole } from "@/server/db/schema/enums";
import type { UserId, WorkspaceId } from "@/shared/types/ids";
import { branded, type WorkspaceInvitationId } from "@/shared/types/ids";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";

export interface WorkspaceMemberRow {
  memberId: string;
  userId: UserId;
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
  email: string;
  createdAt: Date;
}

export interface InvitationResult {
  invitationId: WorkspaceInvitationId;
  token: string;
  expiresAt: Date;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** List active members of a workspace with their mirrored email. */
export async function listMembers(workspaceId: WorkspaceId): Promise<WorkspaceMemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      memberId: workspaceMembers.id,
      userId: workspaceMembers.userId,
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      email: usersTable.email,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(usersTable, eq(usersTable.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)));
  return rows.map((r) => ({ ...r, email: r.email ?? "" }));
}

/** Invite a user by email with a role. Creates a pending, single-use invitation. */
export async function inviteMember(
  workspaceId: WorkspaceId,
  email: string,
  role: WorkspaceRole,
  inviterId: UserId,
): Promise<InvitationResult> {
  const db = getDb();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const rows = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId,
      email: email.toLowerCase(),
      role,
      invitedByUserId: inviterId,
      token,
      status: "pending",
      expiresAt,
    })
    .returning({ id: workspaceInvitations.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create invitation");
  await publishEvent({
    type: "MemberInvited",
    workspaceId,
    actorUserId: inviterId,
    entityType: "member",
    entityId: row.id,
    metadata: { email: email.toLowerCase(), role },
  });
  await writeAudit({
    workspaceId,
    actorUserId: inviterId,
    action: "member.invite",
    targetType: "member",
    targetId: row.id,
    metadata: { email: email.toLowerCase(), role },
  });
  // Email delivery is wired in Phase 18 (Resend). For now the caller surfaces
  // the accept link; see `/invite?token=...`.
  return { invitationId: branded<"WorkspaceInvitationId">(row.id), token, expiresAt };
}

/** Accept a pending, unexpired invitation for the signed-in user. */
export async function acceptInvitation(
  token: string,
  userId: UserId,
  userEmail: string,
): Promise<WorkspaceId> {
  const db = getDb();
  const invites = await db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.token, token),
        eq(workspaceInvitations.status, "pending"),
        isNull(workspaceInvitations.acceptedAt),
      ),
    )
    .limit(1);
  const invite = invites[0];
  if (!invite) throw new Error("Invitation not found or already used.");
  if (invite.expiresAt.getTime() < Date.now()) throw new Error("Invitation has expired.");
  if (invite.email !== userEmail.toLowerCase()) {
    throw new Error("This invitation was sent to a different email address.");
  }

  await db.transaction(async (tx) => {
    // Upsert membership (idempotent if already a member).
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: invite.workspaceId, userId, role: invite.role })
      .onConflictDoUpdate({
        target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        set: { role: invite.role, updatedAt: new Date(), deletedAt: null },
      });
    await tx
      .update(workspaceInvitations)
      .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaceInvitations.id, invite.id));
  });

  await publishEvent({
    type: "MemberAdded",
    workspaceId: invite.workspaceId,
    actorUserId: userId,
    entityType: "member",
    entityId: userId,
    metadata: { role: invite.role, email: invite.email },
  });
  await writeAudit({
    workspaceId: invite.workspaceId,
    actorUserId: userId,
    action: "member.accept_invite",
    targetType: "member",
    targetId: userId,
    metadata: { role: invite.role, invitationId: invite.id },
  });
  return invite.workspaceId;
}

/** Soft-delete a membership. Refuses to remove the workspace owner. */
export async function removeMember(
  workspaceId: WorkspaceId,
  targetUserId: UserId,
  actorId: UserId,
): Promise<void> {
  const db = getDb();
  // Cannot remove the owner.
  const ws = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (ws[0]?.ownerId === targetUserId) {
    throw new Error("Cannot remove the workspace owner. Transfer ownership first.");
  }
  await db
    .update(workspaceMembers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        isNull(workspaceMembers.deletedAt),
      ),
    );
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "member.remove",
    targetType: "member",
    targetId: targetUserId,
    metadata: { targetUserId },
  });
}

/** Pending invitations for a workspace (for the members management UI). */
export async function listPendingInvitations(workspaceId: WorkspaceId) {
  const db = getDb();
  return db
    .select({
      id: workspaceInvitations.id,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      createdAt: workspaceInvitations.createdAt,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.status, "pending"),
        isNull(workspaceInvitations.acceptedAt),
        gt(workspaceInvitations.expiresAt, new Date()), // not expired
      ),
    );
}
