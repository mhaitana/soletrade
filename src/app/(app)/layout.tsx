import { requireWorkspaceContext } from "@/platform/context";

// All (app) routes are auth + workspace scoped and read cookies/DB at request
// time, so they must never be statically prerendered.
export const dynamic = "force-dynamic";
import { listUserWorkspaces } from "@/platform/workspaces";
import { getInstalledModules } from "@/platform/module-installations";
import { unreadCount } from "@/platform/notifications/store";
import { AppShell } from "@/shared/components/app-shell/app-shell";
import type { ModuleKey } from "@/shared/constants/modules";
import type { WorkspaceId } from "@/shared/types/ids";
import type { WorkspaceRole } from "@/server/db/enums";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireWorkspaceContext();
  const [workspaces, installedModules, notificationCount] = await Promise.all([
    listUserWorkspaces(ctx.user.id),
    getInstalledModules(ctx.workspaceId),
    // Best-effort: a DB hiccup shouldn't break the shell render.
    unreadCount(ctx.workspaceId, ctx.user.id).catch(() => 0),
  ]);

  return (
    <AppShell
      workspaces={workspaces.map((w) => ({
        id: w.workspaceId as WorkspaceId,
        name: w.name,
        slug: w.slug,
        role: w.role as WorkspaceRole,
      }))}
      activeWorkspaceId={ctx.workspaceId}
      installedModules={installedModules as ModuleKey[]}
      userEmail={ctx.user.email}
      notificationCount={notificationCount}
    >
      {children}
    </AppShell>
  );
}
