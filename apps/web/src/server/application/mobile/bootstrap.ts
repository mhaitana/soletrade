import "server-only";
import type { MobileBootstrap } from "@soletrade/contracts";
import { getUser } from "@/server/foundation/users";
import { getWorkspace, listUserWorkspaces } from "@/server/foundation/workspaces";
import { getInstalledModules } from "@/server/foundation/module-installations";
import { can, type Permission, type Resource, type Verb } from "@/lib/domain/permissions";
import { unreadCount } from "@/server/foundation/notifications/store";
import { requireMobileContext, requireMobileUser } from "@/server/application/mobile/http";
import { getMobileBilling } from "@/server/application/mobile/billing";
import { getMobilePreferences } from "@/server/application/mobile/account";

export async function mobileBootstrap(request: Request): Promise<MobileBootstrap> {
  const user = await requireMobileUser(request);
  const [profile, workspaces, preferences] = await Promise.all([
    getUser(user.id),
    listUserWorkspaces(user.id),
    getMobilePreferences(user.id),
  ]);
  const requested = new URL(request.url).searchParams.get("workspaceId");
  const candidate = requested || workspaces[0]?.workspaceId;
  const result: MobileBootstrap = {
    user: { ...user, fullName: profile?.fullName ?? null },
    workspaces,
    preferences,
    activeWorkspace: null,
  };
  if (!candidate) return result;
  const ctx = await requireMobileContext(request, candidate);
  const [workspace, modules, billing, count] = await Promise.all([
    getWorkspace(ctx.workspaceId),
    getInstalledModules(ctx.workspaceId),
    getMobileBilling(ctx.workspaceId),
    unreadCount(ctx.workspaceId, ctx.user.id),
  ]);
  const resources: Resource[] = [
    "workspace",
    "billing",
    "module",
    "customer",
    "invoice",
    "quote",
    "books",
    "drive",
    "file",
    "member",
    "activity",
    "audit",
  ];
  const verbs: Verb[] = ["view", "create", "update", "delete", "manage", "invite", "transfer"];
  const capabilities = resources
    .flatMap((resource) => verbs.map((verb) => `${verb}:${resource}` as Permission))
    .filter((permission) => can(ctx.role, permission));
  result.activeWorkspace = {
    id: ctx.workspaceId,
    name: workspace!.name,
    role: ctx.role,
    modules,
    capabilities,
    settings: {
      defaultCurrency: workspace!.defaultCurrency,
      invoicePrefix: workspace!.invoicePrefix,
      quotePrefix: workspace!.quotePrefix,
      timezone: workspace!.timezone,
      fyStartMonth: workspace!.fyStartMonth,
      paymentMethods: workspace!.paymentMethods,
    },
    billing,
    unreadCount: count,
  };
  return result;
}
