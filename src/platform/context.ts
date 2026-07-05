import "server-only";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/server/auth/session";
import type { WorkspaceRole } from "@/server/db/schema/enums";
import {
  getActiveWorkspaceId,
  getMembershipRole,
  listUserWorkspaces,
  setActiveWorkspaceId,
  type WorkspaceMembership,
} from "@/platform/workspaces";
import type { WorkspaceId } from "@/shared/types/ids";

/**
 * Resolved request context for any (app)-group mutation: the signed-in user,
 * the active workspace, and the user's role within it. This is the single
 * primitive every Server Action uses before performing a mutation — the
 * workspace id and role come from the server, never from client input.
 */
export interface WorkspaceContext {
  user: SessionUser;
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
}

/**
 * Resolve the workspace context for the current request. Redirects to
 * `/onboarding` if the user has no workspace, and to `/login` if there's no
 * session. Ensures the active-workspace cookie always points at a workspace
 * the user is actually a member of.
 */
export async function requireWorkspaceContext(): Promise<WorkspaceContext> {
  const user = await requireUser();
  const memberships = await listUserWorkspaces(user.id);
  if (memberships.length === 0) {
    redirect("/onboarding");
  }

  const cookieId = await getActiveWorkspaceId();
  const fromCookie = cookieId ? memberships.find((m) => m.workspaceId === cookieId) : undefined;
  const chosen: WorkspaceMembership = fromCookie ?? memberships[0]!;

  // If the cookie was missing or stale, repair it so subsequent requests are stable.
  if (!fromCookie) {
    await setActiveWorkspaceId(chosen.workspaceId);
  }

  const role = await getMembershipRole(chosen.workspaceId, user.id);
  if (!role) {
    redirect("/onboarding");
  }

  return { user, workspaceId: chosen.workspaceId, role };
}
