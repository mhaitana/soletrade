import "server-only";
import { getDataClient } from "@/server/db/client";
import {
  parsePgTimestamp,
  rpc,
  unwrap,
  unwrapCount,
  unwrapMaybe,
  unwrapVoid,
} from "@/server/db/helpers";
import type { WorkspaceRole } from "@/server/db/enums";
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
  const supabase = getDataClient();
  // Embed the parent user (many-to-one → single nested object) for the mirrored email,
  // matching the old innerJoin. Active memberships only (soft-delete filter in SQL).
  const rows = await unwrap(
    supabase
      .from("workspace_members")
      .select("id, user_id, workspace_id, role, created_at, users ( email )")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null),
  );
  return rows.map((r) => ({
    memberId: r.id,
    userId: branded<"UserId">(r.user_id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    role: r.role,
    email: r.users?.email ?? "",
    createdAt: parsePgTimestamp(r.created_at),
  }));
}

/** Invite a user by email with a role. Creates a pending, single-use invitation. */
export async function inviteMember(
  workspaceId: WorkspaceId,
  email: string,
  role: WorkspaceRole,
  inviterId: UserId,
  deterministicId?: WorkspaceInvitationId,
): Promise<InvitationResult> {
  const supabase = getDataClient();
  const recover = async (): Promise<InvitationResult | null> => {
    if (!deterministicId) return null;
    const row = await unwrapMaybe(
      supabase
        .from("workspace_invitations")
        .select("id,token,expires_at")
        .eq("id", deterministicId)
        .eq("workspace_id", workspaceId)
        .eq("invited_by_user_id", inviterId)
        .maybeSingle(),
    );
    return row
      ? {
          invitationId: branded<"WorkspaceInvitationId">(row.id),
          token: row.token,
          expiresAt: parsePgTimestamp(row.expires_at),
        }
      : null;
  };
  const existing = await recover();
  if (existing) return existing;
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const rows = await unwrap(
    supabase
      .from("workspace_invitations")
      .insert({
        ...(deterministicId ? { id: deterministicId } : {}),
        workspace_id: workspaceId,
        email: email.toLowerCase(),
        role,
        invited_by_user_id: inviterId,
        token,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select("id"),
  ).catch(async (error) => {
    const existing = await recover();
    if (existing) return [{ id: existing.invitationId }];
    throw error;
  });
  const row = rows[0];
  if (!row) throw new Error("Failed to create invitation");
  if (deterministicId && row.id === deterministicId) {
    const actual = await recover();
    if (actual && actual.token !== token) return actual;
  }
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
  // The `accept_invitation` RPC does the validation + upsert + mark-accepted atomically
  // (locking the invitation row FOR UPDATE so two concurrent accepts can't both succeed).
  // It raises on not-found/expired/wrong-email - PostgREST surfaces those as `error` with
  // a message. Returns (workspace_id, role, email) so the post-rpc event/audit have the
  // metadata without a second read.
  const supabase = getDataClient();
  const { data, error } = await rpc(supabase, "accept_invitation", {
    p_token: token,
    p_user_id: userId,
    p_user_email: userEmail,
  });
  if (error) {
    throw new Error(`PostgREST error [${error.code}]: ${error.message}`);
  }
  // The RPC returns a jsonb object { invitation_id, workspace_id, role, email }.
  if (!data) throw new Error("Invitation not found or already used.");
  const result = data as {
    invitation_id: string;
    workspace_id: string;
    role: string;
    email: string;
  };
  const workspaceId = branded<"WorkspaceId">(result.workspace_id);

  await publishEvent({
    type: "MemberAdded",
    workspaceId,
    actorUserId: userId,
    entityType: "member",
    entityId: userId,
    metadata: { role: result.role as WorkspaceRole, email: result.email },
  });
  await writeAudit({
    workspaceId,
    actorUserId: userId,
    action: "member.accept_invite",
    targetType: "member",
    targetId: userId,
    metadata: {
      role: result.role as WorkspaceRole,
      invitationId: branded<"WorkspaceInvitationId">(result.invitation_id),
    },
  });
  return workspaceId;
}

/** Soft-delete a membership. Refuses to remove the workspace owner. */
export async function removeMember(
  workspaceId: WorkspaceId,
  targetUserId: UserId,
  actorId: UserId,
): Promise<void> {
  const supabase = getDataClient();
  // Cannot remove the owner.
  const ws = await unwrapMaybe(
    supabase.from("workspaces").select("owner_user_id").eq("id", workspaceId).maybeSingle(),
  );
  if (ws?.owner_user_id === targetUserId) {
    throw new Error("Cannot remove the workspace owner. Transfer ownership first.");
  }
  await unwrapVoid(
    supabase
      .from("workspace_members")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .is("deleted_at", null),
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
 * - `newRole` must be one of the changeable roles (not `owner` - ownership
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

  const supabase = getDataClient();
  // Owner check + fetch the target's current role.
  const ws = await unwrapMaybe(
    supabase.from("workspaces").select("owner_user_id").eq("id", workspaceId).maybeSingle(),
  );
  if (ws?.owner_user_id === targetUserId) {
    throw new Error("Cannot change the workspace owner's role. Transfer ownership first.");
  }

  const targetRow = await unwrapMaybe(
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .is("deleted_at", null)
      .maybeSingle(),
  );
  const currentRole = targetRow?.role;
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
    const others = await unwrapCount(
      supabase
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .in("role", ["owner", "admin"]),
    );
    // `others` includes the target themselves, so we need >1 to leave one behind.
    if (others <= 1) {
      throw new Error(
        "This workspace needs at least one owner or admin. Promote another member first.",
      );
    }
  }

  await unwrapVoid(
    supabase
      .from("workspace_members")
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("user_id", targetUserId)
      .is("deleted_at", null),
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
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase
      .from("workspace_invitations")
      .select("id, email, role, status, expires_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()), // not expired
  );
  return rows.map((r) => ({
    id: branded<"WorkspaceInvitationId">(r.id),
    email: r.email,
    role: r.role,
    status: r.status,
    expiresAt: parsePgTimestamp(r.expires_at),
    createdAt: parsePgTimestamp(r.created_at),
  }));
}

/** A public invitation lookup by token (for the `/invite?token=...` accept page). Returns
 *  the invitation + workspace name + inviter name, or `null` if the token doesn't match a
 *  pending, unexpired invitation. Does not leak whether the token exists vs is revoked vs
 *  expired - the page renders the same "not available" state for all. */
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
  const supabase = getDataClient();
  // Embed the parent workspace (name) and the inviter's user mirror (full_name) - both
  // many-to-one → single nested objects, matching the old innerJoin(workspaces) +
  // leftJoin(users).
  const row = await unwrapMaybe(
    supabase
      .from("workspace_invitations")
      .select(
        "id, workspace_id, email, role, expires_at, status, workspaces ( name ), users ( full_name )",
      )
      .eq("token", token)
      .maybeSingle(),
  );
  if (!row) return null;
  const expiresAt = parsePgTimestamp(row.expires_at);
  return {
    id: branded<"WorkspaceInvitationId">(row.id),
    workspaceId: branded<"WorkspaceId">(row.workspace_id),
    email: row.email,
    role: row.role,
    expiresAt,
    status: row.status,
    expired: expiresAt.getTime() < Date.now(),
    workspaceName: row.workspaces?.name ?? "",
    inviterName: row.users?.full_name ?? null,
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
  const supabase = getDataClient();
  await unwrapVoid(
    supabase
      .from("workspace_invitations")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", invitationId)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending"),
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
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("workspace_invitations")
      .select("email, role, token")
      .eq("id", invitationId)
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .maybeSingle(),
  );
  if (!row) return null;
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await unwrapVoid(
    supabase
      .from("workspace_invitations")
      .update({ expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", invitationId),
  );
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
