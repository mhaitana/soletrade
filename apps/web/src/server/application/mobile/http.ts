import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { uuidSchema } from "@soletrade/contracts";
import { getDataClient } from "@/server/infrastructure/db/client";
import { getCurrentUser } from "@/server/application/auth/session";
import { type SessionUser } from "@/lib/domain/auth/session-types";
import { getMembershipRole, getWorkspace } from "@/server/foundation/workspaces";
import { ensureUserMirror } from "@/server/foundation/users";
import { rateLimit } from "@/server/infrastructure/rate-limit";
import { branded } from "@/types/ids";
import type { WorkspaceContext } from "@/lib/domain/auth/workspace-context-types";
import type { Json } from "@/lib/domain/json";

export interface MobileWorkspaceContext extends WorkspaceContext {
  operationId?: string;
  signal?: AbortSignal;
}

export class MobileApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export function mobileJson(data: unknown, status = 200): Response {
  return Response.json({ data }, { status, headers: { "cache-control": "private, no-store" } });
}

export async function mobileRoute(work: () => Promise<unknown | Response>): Promise<Response> {
  try {
    const result = await work();
    const response = result instanceof Response ? result : mobileJson(result);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-content-type-options", "nosniff");
    return response;
  } catch (error) {
    const requestId = randomUUID();
    const known = error instanceof MobileApiError;
    const validation = error instanceof ZodError;
    const status = known ? error.status : validation ? 422 : 500;
    // Never log request bodies, credentials, routes or model content.
    if (!known && !validation)
      console.error("Mobile request failed", {
        requestId,
        kind: error instanceof Error ? error.name : "unknown",
      });
    return Response.json(
      {
        error: {
          code: known ? error.code : validation ? "VALIDATION_ERROR" : "INTERNAL_ERROR",
          message: known
            ? error.message
            : validation
              ? "Check the highlighted fields."
              : "We could not complete that request. Please try again.",
          ...(validation ? { fieldErrors: error.flatten().fieldErrors } : {}),
          requestId,
        },
      },
      {
        status,
        headers: {
          "cache-control": "private, no-store",
          "x-request-id": requestId,
          ...(status === 429 ? { "retry-after": "60" } : {}),
        },
      },
    );
  }
}

export async function requireMobileUser(request: Request): Promise<SessionUser> {
  const authorization = request.headers.get("authorization");
  let user: SessionUser | null;
  if (authorization !== null) {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match?.[1]) throw new MobileApiError("UNAUTHENTICATED", "Sign in to continue.", 401);
    const { data, error } = await getDataClient().auth.getUser(match[1]);
    if (error || !data.user?.id)
      throw new MobileApiError("UNAUTHENTICATED", "Your session expired. Sign in again.", 401);
    user = { id: branded<"UserId">(data.user.id), email: data.user.email ?? "" };
  } else {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin)
        throw new MobileApiError(
          "INVALID_ORIGIN",
          "This browser request is not from this application.",
          403,
        );
    }
    user = await getCurrentUser();
  }
  if (!user) throw new MobileApiError("UNAUTHENTICATED", "Sign in to continue.", 401);
  const { data: profile, error } = await getDataClient()
    .from("users")
    .select("id, deleted_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error("Unable to verify account status");
  if (profile?.deleted_at)
    throw new MobileApiError("ACCOUNT_CLOSED", "This account is closed or suspended.", 403);
  if (!profile) await ensureUserMirror({ id: user.id, email: user.email });
  if (!(await rateLimit(`mobile:${user.id}`, { max: 180, windowMs: 60_000 })))
    throw new MobileApiError("RATE_LIMITED", "Too many requests. Try again shortly.", 429);
  return user;
}

export async function requireMobileContext(
  request: Request,
  candidate: string,
): Promise<MobileWorkspaceContext> {
  if (!uuidSchema.safeParse(candidate).success)
    throw new MobileApiError("INVALID_WORKSPACE", "Choose a valid workspace.");
  const user = await requireMobileUser(request);
  const workspaceId = branded<"WorkspaceId">(candidate);
  const [role, workspace] = await Promise.all([
    getMembershipRole(workspaceId, user.id),
    getWorkspace(workspaceId),
  ]);
  if (!role || !workspace || workspace.deletedAt)
    throw new MobileApiError(
      "WORKSPACE_UNAVAILABLE",
      "You no longer have access to this workspace.",
      403,
    );
  return { user, workspaceId, role };
}

export async function readMobileBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000)
    throw new MobileApiError("BODY_TOO_LARGE", "That submission is too large.", 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > 2_000_000)
    throw new MobileApiError("BODY_TOO_LARGE", "That submission is too large.", 413);
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new MobileApiError("INVALID_JSON", "The submission could not be read.");
  }
}

/** Cross-instance claim prevents concurrent/replayed writes. Ambiguous external side effects
 * stay pending: a client must refresh/reconcile rather than blindly send a second email/payment.
 * Domain creates additionally use this UUID as their primary key for lost-response recovery.
 */
export async function runMobileMutation(
  request: Request,
  ctx: MobileWorkspaceContext,
  operation: string,
  body: unknown,
  work: (ctx: MobileWorkspaceContext) => Promise<unknown | Response>,
): Promise<unknown | Response> {
  const operationId = request.headers.get("idempotency-key");
  if (!operationId || !uuidSchema.safeParse(operationId).success)
    throw new MobileApiError(
      "IDEMPOTENCY_REQUIRED",
      "Use a unique operation identifier when saving.",
    );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ operation, method: request.method, body }))
    .digest("hex");
  const db = getDataClient();
  const { data, error } = await db.rpc("mobile_claim_operation", {
    p_id: operationId,
    p_user_id: ctx.user.id,
    p_workspace_id: ctx.workspaceId,
    p_operation: operation,
    p_fingerprint: fingerprint,
  });
  if (error) throw new Error("Could not claim mobile operation");
  const claim = data as { state: string; response?: Json; fingerprint?: string };
  if (claim.state === "mismatch")
    throw new MobileApiError(
      "OPERATION_REUSED",
      "This saved request changed. Save it as a new operation.",
      409,
    );
  if (claim.state === "complete") return claim.response;
  // These domain creates insert the operation UUID as their primary key and
  // recover the existing row on a unique race. They can safely finish a request
  // whose original response/ledger completion was lost. External lifecycle
  // effects remain fail-closed until reconciled instead of being blindly replayed.
  const recoverableCreate =
    request.method === "POST" &&
    /\/(customers|invoices|quotes|books\/transactions|books\/receipts\/extract|drive\/(earnings|trips|vehicles|expenses)|files\/upload|assistant\/conversations)$/.test(
      operation,
    );
  if (claim.state !== "claimed" && !recoverableCreate)
    throw new MobileApiError(
      "OPERATION_PENDING",
      "This request is still processing. Refresh its status before trying again.",
      409,
    );
  try {
    const result = await work({ ...ctx, operationId });
    if (result instanceof Response) {
      if (!result.ok)
        throw new MobileApiError(
          "OPERATION_FAILED",
          "The operation was not completed.",
          result.status,
        );
      const payload = (await result.clone().json()) as Json;
      const { error: finishError } = await db
        .from("mobile_api_operations")
        .update({ status: "complete", response: payload, updated_at: new Date().toISOString() })
        .eq("id", operationId)
        .eq("user_id", ctx.user.id);
      if (finishError) throw new Error("Could not record mobile operation result");
      return result;
    }
    const payload = JSON.parse(JSON.stringify(result ?? null)) as Json;
    const { error: finishError } = await db
      .from("mobile_api_operations")
      .update({ status: "complete", response: payload, updated_at: new Date().toISOString() })
      .eq("id", operationId)
      .eq("user_id", ctx.user.id);
    if (finishError) throw new Error("Could not record mobile operation result");
    return result;
  } catch (error) {
    // Validation/authz/conflict failures happen before effects and can safely be corrected.
    if (
      error instanceof ZodError ||
      (error instanceof MobileApiError && [400, 403, 404, 409, 422].includes(error.status))
    ) {
      await db
        .from("mobile_api_operations")
        .delete()
        .eq("id", operationId)
        .eq("user_id", ctx.user.id)
        .eq("status", "processing");
    }
    throw error;
  }
}

/** A streamed turn may have executed confirmed tools before a connection is lost.
 * Its durable claim is never replayed; the client reloads the persisted conversation.
 */
export async function runMobileStream(
  request: Request,
  ctx: MobileWorkspaceContext,
  operation: string,
  body: unknown,
  work: (context: MobileWorkspaceContext) => Promise<unknown | Response>,
) {
  const operationId = request.headers.get("idempotency-key");
  if (!operationId || !uuidSchema.safeParse(operationId).success)
    throw new MobileApiError("IDEMPOTENCY_REQUIRED", "Use a unique message identifier.");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ operation, body }))
    .digest("hex");
  const { data, error } = await getDataClient().rpc("mobile_claim_operation", {
    p_id: operationId,
    p_user_id: ctx.user.id,
    p_workspace_id: ctx.workspaceId,
    p_operation: operation,
    p_fingerprint: fingerprint,
  });
  if (error) throw new Error("Unable to claim assistant turn");
  const claim = data as { state: string };
  if (claim.state !== "claimed")
    throw new MobileApiError(
      "ASSISTANT_TURN_ACCEPTED",
      "This message was already accepted. Reload the conversation to see its result; it will not be executed again.",
      409,
    );
  return work({ ...ctx, operationId, signal: request.signal });
}
