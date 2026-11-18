import "server-only";
import { z } from "zod";
import { mobileBootstrap } from "@/server/application/mobile/bootstrap";
import {
  MobileApiError,
  mobileRoute,
  readMobileBody,
  requireMobileContext,
  requireMobileUser,
  runMobileMutation,
  runMobileStream,
} from "@/server/application/mobile/http";
import {
  acceptOwnershipTransfer,
  deletePrivateRoutes,
  getMobilePreferences,
  listPrivateRoutes,
  ownershipTransfers,
  registerMobileDevice,
  removeMobileDevice,
  requestAccountDeletion,
  requestOwnershipTransfer,
  savePrivateRoute,
  updateMobilePreferences,
} from "@/server/application/mobile/account";
import {
  cancelStorePurchaseIntent,
  getMobileBillingDetails,
  startStorePurchaseIntent,
  storeCatalog,
  verifyStorePurchase,
} from "@/server/application/mobile/billing";
import { can } from "@/lib/domain/permissions/index";
import { readMobileResource, writeMobileResource } from "@/server/application/mobile/resources";
import { authorizeMobileOperation } from "@/server/application/mobile/authorization";
import { createWorkspace, listUserWorkspaces } from "@/server/foundation/workspaces/index";
import { getDataClient } from "@/server/infrastructure/db/client";
import { updateUserFullName } from "@/server/foundation/users/index";
import { acceptInvitation } from "@/server/foundation/members/index";
import { POST as assistantPost } from "@/server/application/http/api/assistant/handler";
import { branded } from "@/types/ids";
import {
  appleStoreNotification,
  googleStoreNotification,
} from "@/server/application/mobile/store-events";
import { recordMobileHealth } from "@/server/application/mobile/health";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context) {
  return mobileRoute(async () => {
    const { path } = await context.params;
    const key = path.join("/");
    const url = new URL(request.url);
    const method = request.method;
    if (key === "webhooks/apple" && method === "POST")
      return appleStoreNotification(await readMobileBody(request));
    if (key === "webhooks/google" && method === "POST")
      return googleStoreNotification(request, await readMobileBody(request));
    if (key === "bootstrap" && method === "GET") return mobileBootstrap(request);
    if (path[0] === "workspaces" && path[1]) {
      const ctx = await requireMobileContext(request, path[1]);
      const resource = path.slice(2);
      await authorizeMobileOperation(ctx, resource, method);
      if (resource.join("/") === "billing" && method === "GET") {
        if (!can(ctx.role, "view:billing"))
          throw new MobileApiError("FORBIDDEN", "Your role cannot view billing.", 403);
        return getMobileBillingDetails(ctx.workspaceId);
      }
      if (!resource.length)
        throw new MobileApiError("NOT_FOUND", "Choose a workspace section.", 404);
      if (resource.join("/") === "assistant/chat" && method === "POST") {
        const headers = new Headers(request.headers);
        headers.set("x-workspace-id", ctx.workspaceId);
        const forwarded = new Request(request, { headers });
        const body = await readMobileBody(forwarded.clone());
        return runMobileStream(request, ctx, key, body, () => assistantPost(forwarded));
      }
      if (method === "GET") return readMobileResource(ctx, resource, url.searchParams);
      if (!["POST", "PATCH", "DELETE"].includes(method))
        throw new MobileApiError("METHOD_NOT_ALLOWED", "That operation is not supported.", 405);
      const body = await readMobileBody(request);
      if (
        resource[0] === "assistant" &&
        (resource.at(-1) === "messages" || resource.at(-1) === "approvals") &&
        method === "POST"
      )
        return runMobileStream(request, ctx, key, body, (streamCtx) =>
          writeMobileResource(streamCtx, resource, "POST", body),
        );
      const expectedVersion = request.headers.get("if-match")?.replace(/^"|"$/g, "");
      const input =
        expectedVersion && body && typeof body === "object" && !Array.isArray(body)
          ? { ...body, expectedVersion }
          : body;
      return runMobileMutation(request, ctx, key, input, (operationCtx) =>
        writeMobileResource(operationCtx, resource, method as "POST" | "PATCH" | "DELETE", input),
      );
    }
    const user = await requireMobileUser(request);
    if (key === "me/health" && method === "POST")
      return recordMobileHealth(user.id, await readMobileBody(request));
    if (key === "me/preferences") {
      if (method === "GET") return getMobilePreferences(user.id);
      if (method === "PATCH")
        return updateMobilePreferences(user.id, await readMobileBody(request));
    }
    if (["me", "me/profile"].includes(key) && method === "PATCH") {
      const input = z
        .object({ fullName: z.string().trim().min(1).max(120) })
        .parse(await readMobileBody(request));
      await updateUserFullName(user.id, input.fullName);
      return { fullName: input.fullName };
    }
    if (key === "me/devices" && method === "POST")
      return registerMobileDevice(user.id, await readMobileBody(request));
    if (path[0] === "me" && path[1] === "devices" && path[2] && method === "DELETE")
      return removeMobileDevice(user.id, path[2]);
    if (key === "me/routes" && method === "GET")
      return listPrivateRoutes(
        user.id,
        url.searchParams.get("since") ?? undefined,
        url.searchParams.get("cursor") ?? undefined,
      );
    if (key === "me/routes" && method === "POST")
      return savePrivateRoute(request, user.id, await readMobileBody(request));
    if (path[0] === "me" && path[1] === "routes" && method === "DELETE")
      return deletePrivateRoutes(user.id, path[2]);
    if (key === "me/deletion" && method === "POST")
      return requestAccountDeletion(request, user, await readMobileBody(request));
    if (["me/transfers", "me/ownership-transfers"].includes(key) && method === "GET")
      return ownershipTransfers(user.id);
    if (["me/transfers", "me/ownership-transfers"].includes(key) && method === "POST")
      return requestOwnershipTransfer(user, await readMobileBody(request));
    if (
      path[0] === "me" &&
      ["transfers", "ownership-transfers"].includes(path[1] ?? "") &&
      path[2] &&
      path[3] === "accept" &&
      method === "POST"
    )
      return acceptOwnershipTransfer(user.id, path[2]);
    if (key === "invitations/accept" && method === "POST") {
      const input = z
        .object({ token: z.string().min(1).max(200) })
        .parse(await readMobileBody(request));
      return { workspaceId: await acceptInvitation(input.token, user.id, user.email) };
    }
    if (key === "workspaces" && method === "GET")
      return { items: await listUserWorkspaces(user.id) };
    if (key === "workspaces" && method === "POST") {
      const input = z
        .object({ name: z.string().trim().min(1).max(120) })
        .parse(await readMobileBody(request));
      const operationId = z.uuid().parse(request.headers.get("idempotency-key"));
      const slug = `${input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 45)}-${operationId}`;
      const { data: existing, error } = await getDataClient()
        .from("workspaces")
        .select("id,owner_user_id")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw new Error("Unable to check workspace creation");
      if (existing && existing.owner_user_id !== user.id)
        throw new MobileApiError("OPERATION_REUSED", "Choose a new operation identifier.", 409);
      return { workspaceId: existing?.id ?? (await createWorkspace(user.id, input.name, slug)) };
    }
    if (key === "billing/store/catalog" && method === "GET") {
      const workspaceId = z.uuid().parse(url.searchParams.get("workspaceId"));
      await requireMobileContext(request, workspaceId);
      const provider = z
        .enum(["apple", "google"])
        .optional()
        .parse(url.searchParams.get("provider") ?? undefined);
      return storeCatalog(user.id, branded<"WorkspaceId">(workspaceId), provider);
    }
    if (key === "billing/store/verify" && method === "POST") {
      const body = await readMobileBody(request);
      const { workspaceId } = z.object({ workspaceId: z.uuid() }).parse(body);
      const ctx = await requireMobileContext(request, workspaceId);
      return verifyStorePurchase(user.id, ctx.workspaceId, body);
    }
    if (
      ["billing/store/intent", "billing/store/intent/cancel"].includes(key) &&
      method === "POST"
    ) {
      const body = await readMobileBody(request);
      const { workspaceId } = z.object({ workspaceId: z.uuid() }).parse(body);
      const ctx = await requireMobileContext(request, workspaceId);
      return key.endsWith("/cancel")
        ? cancelStorePurchaseIntent(user.id, ctx.workspaceId, body)
        : startStorePurchaseIntent(user.id, ctx.workspaceId, body);
    }
    if (path[0] === "operations" && path[1] && method === "GET") {
      const { data, error } = await getDataClient()
        .from("mobile_api_operations")
        .select("id,status,response,updated_at,workspace_id,operation")
        .eq("id", z.uuid().parse(path[1]))
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw new Error("Unable to check operation status");
      if (!data) throw new MobileApiError("NOT_FOUND", "This operation was not found.", 404);
      if (data.workspace_id) {
        const ctx = await requireMobileContext(request, data.workspace_id);
        await authorizeMobileOperation(ctx, data.operation.split("/").slice(2), "GET");
      }
      return data;
    }
    throw new MobileApiError("NOT_FOUND", "This endpoint was not found.", 404);
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
