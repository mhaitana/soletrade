import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import type { WorkspaceRole } from "@/server/db/enums";
import {
  getActiveWorkspaceId,
  listUserWorkspaces,
  type WorkspaceMembership,
} from "@/platform/workspaces";
import type { WorkspaceId } from "@/shared/types/ids";
import { tryAdminContext } from "@/platform/admin/services/admin-auth";

/**
 * Resolved request context for any (app)-group mutation: the signed-in user,
 * the active workspace, and the user's role within it. This is the single
 * primitive every Server Action uses before performing a mutation - the
 * workspace id and role come from the server, never from client input.
 */
export interface WorkspaceContext {
  user: SessionUser;
  workspaceId: WorkspaceId;
  role: WorkspaceRole;
}

/**
 * Resolve the workspace context WITHOUT redirecting. Returns `null` when there is no
 * session, no workspace, or no membership - the cases where `requireWorkspaceContext`
 * would redirect to `/login` / `/onboarding`. Route Handlers (e.g. the streaming AI
 * assistant endpoint) can't redirect - a `redirect()` call throws a `NEXT_REDIRECT`
 * sentinel that can't be turned into an HTTP response - so they use this variant and
 * map `null` to a `401`/`403`.
 *
 * Read-only: this is called from Server Component renders (layout, dashboard, PDF/report
 * routes), where Next forbids `cookies().set()` - "Setting cookies is not supported during
 * Server Component rendering" (see Next `cookies` docs). So we validate the active-workspace
 * cookie against the user's memberships and fall back to the first membership if the cookie
 * is missing or stale, but we never WRITE the cookie here. The resolved workspace is always a
 * valid membership; the cookie itself is persisted only by the explicit activation actions
 * (`switchWorkspace` / `createWorkspace` / `acceptInvite`), which run in Server Action contexts
 * where cookie writes are allowed.
 */
async function resolveWorkspaceContext(): Promise<WorkspaceContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  // The cookie lookup is local request work, so start it alongside the only DB
  // query needed to resolve the workspace. Each membership row already carries
  // its role; re-querying the selected row used to add a serial round trip.
  const [memberships, cookieId] = await Promise.all([
    listUserWorkspaces(user.id),
    getActiveWorkspaceId(),
  ]);
  if (memberships.length === 0) return null;

  const fromCookie = cookieId ? memberships.find((m) => m.workspaceId === cookieId) : undefined;
  const chosen: WorkspaceMembership = fromCookie ?? memberships[0]!;

  return { user, workspaceId: chosen.workspaceId, role: chosen.role };
}

export const tryWorkspaceContext = cache(resolveWorkspaceContext);

/**
 * Resolve the workspace context for the current request. Redirects to
 * `/onboarding` if the user has no workspace, and to `/login` if there's no
 * session. Thin wrapper over `tryWorkspaceContext` - redirects on the `null`
 * cases so Server Actions / server components keep their "always returns a
 * context" contract. An unauthenticated user is routed to /onboarding, which
 * itself bounces unauthenticated users to /login (preserving pre-refactor
 * behaviour without a second session round-trip here).
 */
async function resolveRequiredWorkspaceContext(): Promise<WorkspaceContext> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) {
    const adminCtx = await tryAdminContext();
    if (adminCtx && adminCtx.roles.includes("super_admin")) {
      redirect("/admin");
    }
    redirect("/onboarding");
  }
  return ctx;
}

export const requireWorkspaceContext = cache(resolveRequiredWorkspaceContext);
