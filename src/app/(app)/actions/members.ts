"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import {
  inviteMember,
  listMembers,
  listPendingInvitations,
  removeMember,
} from "@/platform/members";
import type { WorkspaceRole } from "@/server/db/schema/enums";
import { branded } from "@/shared/types/ids";

const INVITABLE_ROLES = ["admin", "manager", "accountant", "employee", "readonly"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const forbid = (msg = "You don't have permission to do that.") => ({
  ok: false as const,
  error: msg,
});

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(INVITABLE_ROLES),
});

export type InviteMemberResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function inviteMemberAction(input: unknown): Promise<InviteMemberResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "invite:member").ok) return forbid();

  try {
    const result = await inviteMember(
      ctx.workspaceId,
      parsed.data.email,
      parsed.data.role,
      ctx.user.id,
    );
    revalidatePath("/settings/members");
    return { ok: true, token: result.token, expiresAt: result.expiresAt.toISOString() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to invite member." };
  }
}

const removeSchema = z.object({ userId: z.string().uuid() });

export type RemoveMemberResult = { ok: true } | { ok: false; error: string };

export async function removeMemberAction(input: unknown): Promise<RemoveMemberResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid user." };

  const ctx = await requireWorkspaceContext();
  if (!authorize(ctx.role, "manage:member").ok) return forbid();
  if (ctx.user.id === parsed.data.userId) {
    return { ok: false, error: "You cannot remove yourself. Ask another admin." };
  }

  try {
    await removeMember(ctx.workspaceId, branded<"UserId">(parsed.data.userId), ctx.user.id);
    revalidatePath("/settings/members");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove member." };
  }
}

export type MembersPageData = {
  members: { userId: string; role: WorkspaceRole; email: string; createdAt: string }[];
  invitations: {
    id: string;
    email: string;
    role: WorkspaceRole;
    expiresAt: string;
    createdAt: string;
  }[];
  canInvite: boolean;
  canManage: boolean;
};

/** Server-only data loader for the members page (not a mutation). */
export async function loadMembersPage(): Promise<MembersPageData> {
  const ctx = await requireWorkspaceContext();
  const [members, invitations] = await Promise.all([
    listMembers(ctx.workspaceId),
    listPendingInvitations(ctx.workspaceId),
  ]);
  const canInvite = authorize(ctx.role, "invite:member").ok;
  const canManage = authorize(ctx.role, "manage:member").ok;
  return {
    canInvite,
    canManage,
    members: members.map((m) => ({
      userId: m.userId,
      role: m.role,
      email: m.email,
      createdAt: m.createdAt.toISOString(),
    })),
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    })),
  };
}
