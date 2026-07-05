import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
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
 * Resolve the workspace context WITHOUT redirecting. Returns `null` when there is no
 * session, no workspace, or no membership — the cases where `requireWorkspaceContext`
 * would redirect to `/login` / `/onboarding`. Route Handlers (e.g. the streaming AI
 * assistant endpoint) can't redirect — a `redirect()` call throws a `NEXT_REDIRECT`
 * sentinel that can't be turned into an HTTP response — so they use this variant and
 * map `null` to a `401`/`403`. Ensures the active-workspace cookie always points at a
 * workspace the user is actually a member of (same repair as the requiring variant).
 */
export async function tryWorkspaceContext(): Promise<WorkspaceContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const memberships = await listUserWorkspaces(user.id);
  if (memberships.length === 0) return null;

  const cookieId = await getActiveWorkspaceId();
  const fromCookie = cookieId ? memberships.find((m) => m.workspaceId === cookieId) : undefined;
  const chosen: WorkspaceMembership = fromCookie ?? memberships[0]!;

  // If the cookie was missing or stale, repair it so subsequent requests are stable.
  if (!fromCookie) {
    await setActiveWorkspaceId(chosen.workspaceId);
  }

  const role = await getMembershipRole(chosen.workspaceId, user.id);
  if (!role) return null;

  return { user, workspaceId: chosen.workspaceId, role };
}

/**
 * Resolve the workspace context for the current request. Redirects to
 * `/onboarding` if the user has no workspace, and to `/login` if there's no
 * session. Thin wrapper over `tryWorkspaceContext` — redirects on the `null`
 * cases so Server Actions / server components keep their "always returns a
 * context" contract. An unauthenticated user is routed to /onboarding, which
 * itself bounces unauthenticated users to /login (preserving pre-refactor
 * behaviour without a second session round-trip here).
 */
export async function requireWorkspaceContext(): Promise<WorkspaceContext> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) {
    redirect("/onboarding");
  }
  return ctx;
}
