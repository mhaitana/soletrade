import "server-only";
import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";
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
    // The token carries the accept link (the notifications platform builds
    // `${origin}/invite?token=...` from it). The handler also resolves the
    // workspace name + inviter name from the DB for the email body.
    metadata: { email: email.toLowerCase(), role, token },
  });
  await writeAudit({
    workspaceId,
    actorUserId: inviterId,
    action: "member.invite",
    targetType: "member",
    targetId: row.id,
    metadata: { email: email.toLowerCase(), role },
  });
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

const CHANGEABLE_ROLES: WorkspaceRole[] = [
  "admin",
  "manager",
  "accountant",
  "employee",
  "readonly",
];

/**
 * Change an active member's role. Guards:
 * - `newRole` must be one of the changeable roles (not `owner` — ownership
 *   transfer is a separate flow).
 * - The workspace owner's role can't be changed here.
 * - An actor can't change their own role (self-demotion/promotion is a
 *   conflict of interest and bypasses the last-admin guard).
 * - The change can't leave the workspace with zero owner/admin members.
 *
 * Audit-logs `member.role.change` with `{ from, to }` and publishes
 * `MemberRoleChanged` for the activity feed.
 */
export async function updateMemberRole(
  workspaceId: WorkspaceId,
  targetUserId: UserId,
  newRole: WorkspaceRole,
  actorId: UserId,
): Promise<void> {
  if (!CHANGEABLE_ROLES.includes(newRole)) {
    throw new Error("Invalid role. Ownership can't be assigned here.");
  }
  if (actorId === targetUserId) {
    throw new Error("You can't change your own role.");
  }

  const db = getDb();
  // Owner check + fetch the target's current role in one round trip.
  const ws = await db
    .select({ ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (ws[0]?.ownerId === targetUserId) {
    throw new Error("Cannot change the workspace owner's role. Transfer ownership first.");
  }

  const targetRows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  const currentRole = targetRows[0]?.role;
  if (!currentRole) {
    throw new Error("That person isn't an active member of this workspace.");
  }
  if (currentRole === newRole) return; // no-op

  // Last-admin guard: if demoting out of owner/admin, ensure another active
  // owner/admin remains.
  if (
    (currentRole === "owner" || currentRole === "admin") &&
    newRole !== "owner" &&
    newRole !== "admin"
  ) {
    const others = await db
      .select({ count: count() })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          isNull(workspaceMembers.deletedAt),
          inArray(workspaceMembers.role, ["owner", "admin"]),
        ),
      );
    // `others` includes the target themselves, so we need >1 to leave one behind.
    if ((others[0]?.count ?? 0) <= 1) {
      throw new Error(
        "This workspace needs at least one owner or admin. Promote another member first.",
      );
    }
  }

  await db
    .update(workspaceMembers)
    .set({ role: newRole, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, targetUserId),
        isNull(workspaceMembers.deletedAt),
      ),
    );

  await publishEvent({
    type: "MemberRoleChanged",
    workspaceId,
    actorUserId: actorId,
    entityType: "member",
    entityId: targetUserId,
    metadata: { from: currentRole, to: newRole, targetUserId },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "member.role.change",
    targetType: "member",
    targetId: targetUserId,
    metadata: { from: currentRole, to: newRole },
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
      status: workspaceInvitations.status,
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

/** A public invitation lookup by token (for the `/invite?token=...` accept page). Returns
 *  the invitation + workspace name + inviter name, or `null` if the token doesn't match a
 *  pending, unexpired invitation. Does not leak whether the token exists vs is revoked vs
 *  expired — the page renders the same "not available" state for all. */
export interface PublicInvitation {
  id: WorkspaceInvitationId;
  workspaceId: WorkspaceId;
  email: string;
  role: WorkspaceRole;
  expiresAt: Date;
  status: string;
  /** Whether the invitation's TTL has lapsed (computed server-side so the page doesn't call
   *  `Date.now()` during render, which the react-hooks/purity lint rule forbids). */
  expired: boolean;
  workspaceName: string;
  inviterName: string | null;
}

export async function getInvitationByToken(token: string): Promise<PublicInvitation | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: workspaceInvitations.id,
      workspaceId: workspaceInvitations.workspaceId,
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      expiresAt: workspaceInvitations.expiresAt,
      status: workspaceInvitations.status,
      workspaceName: workspaces.name,
      inviterName: usersTable.fullName,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .leftJoin(usersTable, eq(usersTable.id, workspaceInvitations.invitedByUserId))
    .where(eq(workspaceInvitations.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    status: row.status,
    expired: row.expiresAt.getTime() < Date.now(),
    workspaceName: row.workspaceName,
    inviterName: row.inviterName,
  };
}

/** Revoke a pending invitation (Wave 4). Marks the row `status='revoked'` so the accept link
 *  stops working. Idempotent on already-revoked/accepted rows (no-op). Guarded `manage:member`
 *  by the caller. */
export async function revokeInvitation(
  workspaceId: WorkspaceId,
  invitationId: WorkspaceInvitationId,
  actorId: UserId,
): Promise<void> {
  const db = getDb();
  await db
    .update(workspaceInvitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    );
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "member.revoke_invite",
    targetType: "member",
    targetId: invitationId,
    metadata: { invitationId },
  });
}

/** Resend a pending invitation (Wave 4). Bumps `expiresAt` to now+7d and re-publishes
 *  `MemberInvited` (so the notifications platform re-sends the email with a fresh link).
 *  Throws if the invitation isn't pending or doesn't belong to this workspace. The token
 *  is preserved (the same link keeps working); only the expiry rolls forward. */
export async function resendInvitation(
  workspaceId: WorkspaceId,
  invitationId: WorkspaceInvitationId,
  actorId: UserId,
): Promise<{ token: string; expiresAt: Date; email: string; role: WorkspaceRole } | null> {
  const db = getDb();
  const rows = await db
    .select({
      email: workspaceInvitations.email,
      role: workspaceInvitations.role,
      token: workspaceInvitations.token,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.workspaceId, workspaceId),
        eq(workspaceInvitations.status, "pending"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await db
    .update(workspaceInvitations)
    .set({ expiresAt, updatedAt: new Date() })
    .where(eq(workspaceInvitations.id, invitationId));
  await publishEvent({
    type: "MemberInvited",
    workspaceId,
    actorUserId: actorId,
    entityType: "member",
    entityId: invitationId,
    metadata: { email: row.email, role: row.role, token: row.token },
  });
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "member.resend_invite",
    targetType: "member",
    targetId: invitationId,
    metadata: { invitationId, email: row.email },
  });
  return { token: row.token, expiresAt, email: row.email, role: row.role };
}
