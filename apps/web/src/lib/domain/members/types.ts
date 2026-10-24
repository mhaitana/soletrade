import type { WorkspaceRole } from "@/lib/domain/database-enums";
import type { UserId, WorkspaceId } from "@/types/ids";
import type { WorkspaceInvitationId } from "@/types/ids";

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
