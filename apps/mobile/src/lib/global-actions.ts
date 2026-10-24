import type { MobileModule } from "@soletrade/contracts";
import { canWrite, catalog } from "./catalog";
export type GlobalCreateAction = { label: string; href: string };
const creatable = [
  "invoices",
  "quotes",
  "customers",
  "books/transactions",
  "drive/earnings",
  "drive/trips",
  "drive/vehicles",
  "drive/expenses",
  "invitations",
  "files",
];
function routeResource(pathname: string) {
  const match = pathname.match(/^\/(?:resource|edit)\/(.+)/);
  if (!match) return "";
  try {
    const parts = match[1].split("/");
    const first = decodeURIComponent(parts[0]);
    return catalog[first] ? first : `${first}/${parts[1] ?? ""}`;
  } catch {
    return "";
  }
}
export function contextualCreate(
  pathname: string,
  modules: MobileModule[],
  capabilities: string[],
): GlobalCreateAction | null {
  const resource = routeResource(pathname);
  const context = resource === "members" ? "invitations" : resource;
  const tab = pathname.replace(/^\/\(tabs\)/, "");
  const preferred = context
    ? [context]
    : tab === "/money"
      ? ["books/transactions"]
      : tab === "/drive"
        ? ["drive/earnings"]
        : tab === "/sales"
          ? ["invoices", "quotes", "customers"]
          : [];
  for (const resource of [...preferred, ...creatable]) {
    if (!creatable.includes(resource)) continue;
    const spec = catalog[resource];
    if (!spec || spec.readOnly || spec.singleton || (spec.module && !modules.includes(spec.module)))
      continue;
    if (resource === "files") {
      if (capabilities.includes("manage:file") || capabilities.includes("*"))
        return { label: "Upload file", href: "/upload" };
      continue;
    }
    if (canWrite(capabilities, resource))
      return {
        label: `Create ${spec.singular}`,
        href: `/edit/${encodeURIComponent(resource)}/new`,
      };
  }
  return null;
}
export function privateToolbarAllowed(input: {
  authenticated: boolean;
  pathname: string;
  userId: string;
  bootstrapUserId?: string;
  workspaceId: string;
  activeWorkspaceId?: string;
  requestedUser?: string;
  requestedWorkspace?: string;
}) {
  return !!(
    input.authenticated &&
    input.userId &&
    input.workspaceId &&
    input.bootstrapUserId === input.userId &&
    input.activeWorkspaceId === input.workspaceId &&
    (!input.requestedUser || input.requestedUser === input.userId) &&
    (!input.requestedWorkspace || input.requestedWorkspace === input.workspaceId) &&
    !/^\/(sign-in|auth|invite|legal)(\/|$)/.test(input.pathname)
  );
}
