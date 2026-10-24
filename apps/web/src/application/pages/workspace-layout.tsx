import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";

// All (app) routes are auth + workspace scoped and read cookies/DB at request
// time, so they must never be statically prerendered.

import { listUserWorkspaces } from "@/server/foundation/workspaces/index";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { unreadCount } from "@/server/foundation/notifications/store";
import { AppShell } from "@/application/shell/app-shell";
import type { ModuleKey } from "@/config/modules";
import type { WorkspaceId } from "@/types/ids";
import type { WorkspaceRole } from "@/lib/domain/database-enums";

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
      role={ctx.role}
      userEmail={ctx.user.email}
      notificationCount={notificationCount}
    >
      {children}
    </AppShell>
  );
}
