import { can, type Permission, type Resource } from "@/platform/permissions";
import { isModuleEnabled } from "@/platform/module-installations";
import { MobileApiError, type MobileWorkspaceContext } from "@/platform/mobile/http";
import type { ModuleKey } from "@/shared/constants/modules";

/** Runs before looking up cached mutation responses as well as before new work. */
export async function authorizeMobileOperation(
  ctx: MobileWorkspaceContext,
  path: string[],
  method: string,
) {
  const first = path[0];
  const resource: Resource | undefined = (
    {
      customers: "customer",
      invoices: "invoice",
      quotes: "quote",
      books: "books",
      drive: "drive",
      files: "file",
      members: "member",
      invitations: "member",
      settings: "workspace",
      billing: "billing",
      assistant: "workspace",
      notifications: "workspace",
      audit: "audit",
      activity: "activity",
      dashboard: "workspace",
      search: "workspace",
    } as Record<string, Resource>
  )[first ?? ""];
  if (!resource) throw new MobileApiError("NOT_FOUND", "This resource was not found.", 404);
  const moduleKey: ModuleKey | undefined = (
    { invoices: "invoices", quotes: "quotes", books: "books", drive: "drive" } as Record<
      string,
      ModuleKey
    >
  )[first ?? ""];
  if (moduleKey && !(await isModuleEnabled(ctx.workspaceId, moduleKey)))
    throw new MobileApiError("MODULE_UNAVAILABLE", "This module is not enabled.", 404);
  let permission: Permission;
  if (method === "GET") permission = `view:${resource}`;
  else if (first === "assistant" || first === "notifications") permission = "view:workspace";
  else if (first === "settings") permission = "update:workspace";
  else if (first === "members" || first === "invitations")
    permission =
      method === "POST" &&
      (path.length === 1 || path.at(-1) === "resend" || path.at(-1) === "revoke")
        ? "invite:member"
        : "manage:member";
  else if (first === "billing") permission = "manage:billing";
  else {
    const isCreate =
      method === "POST" &&
      (path.length === 1 ||
        (first === "drive" && path.length === 2 && path[1] !== "settings") ||
        (first === "books" && path[1] === "transactions" && path.length === 2) ||
        (first === "books" &&
          path[1] === "receipts" &&
          ["extract", "apply"].includes(path.at(-1) ?? "")) ||
        (first === "files" && ["upload", "upload-url"].includes(path[1] ?? "")));
    permission = `${method === "DELETE" ? "delete" : isCreate ? "create" : "update"}:${resource}`;
  }
  if (!can(ctx.role, permission))
    throw new MobileApiError("FORBIDDEN", "Your current role does not allow this operation.", 403);
}
