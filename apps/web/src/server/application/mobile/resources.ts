import "server-only";
import { MobileApiError, type MobileWorkspaceContext } from "@/server/application/mobile/http";
import { missing, query } from "@/server/application/mobile/resources/common";
export async function readMobileResource(
  ctx: MobileWorkspaceContext,
  path: string[],
  params: URLSearchParams,
): Promise<unknown | Response> {
  const q = query(params);
  switch (path[0]) {
    case "invoices":
    case "quotes":
      return (await import("@/server/application/mobile/resources/sales")).readSales(ctx, path, q);
    case "books":
      return (await import("@/server/application/mobile/resources/books")).readBooks(
        ctx,
        path.slice(1),
        q,
      );
    case "drive":
      return (await import("@/server/application/mobile/resources/drive")).readDrive(
        ctx,
        path.slice(1),
        q,
      );
    case "customers":
    case "dashboard":
    case "files":
    case "activity":
    case "audit":
    case "notifications":
    case "members":
    case "invitations":
    case "settings":
    case "search":
    case "assistant":
      return (await import("@/server/application/mobile/resources/platform")).readPlatform(
        ctx,
        path,
        q,
      );
    default:
      return missing();
  }
}
async function dispatchWriteResource(
  ctx: MobileWorkspaceContext,
  path: string[],
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): Promise<unknown | Response> {
  switch (path[0]) {
    case "invoices":
    case "quotes":
      return (await import("@/server/application/mobile/resources/sales")).writeSales(
        ctx,
        path,
        method,
        body,
      );
    case "books":
      return (await import("@/server/application/mobile/resources/books")).writeBooks(
        ctx,
        path.slice(1),
        method,
        body,
      );
    case "drive":
      return (await import("@/server/application/mobile/resources/drive")).writeDrive(
        ctx,
        path.slice(1),
        method,
        body,
      );
    case "customers":
    case "files":
    case "notifications":
    case "members":
    case "invitations":
    case "settings":
    case "assistant":
      return (await import("@/server/application/mobile/resources/platform")).writePlatform(
        ctx,
        path,
        method,
        body,
      );
    default:
      return missing();
  }
}

export async function writeMobileResource(
  ctx: MobileWorkspaceContext,
  path: string[],
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): Promise<unknown | Response> {
  try {
    return await dispatchWriteResource(ctx, path, method, body);
  } catch (error) {
    if (
      (error instanceof Error && /PostgREST error \[40001\]/.test(error.message)) ||
      (error && typeof error === "object" && "code" in error && error.code === "40001")
    )
      throw new MobileApiError("conflict", "This record changed. Refresh before saving.", 409);
    throw error;
  }
}
