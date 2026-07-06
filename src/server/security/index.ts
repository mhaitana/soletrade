import "server-only";
import { headers } from "next/headers";
import { authorize, type Permission, type PermissionCheckResult } from "@/platform/permissions";
import { auditAuthzDenial } from "@/platform/audit";
import type { WorkspaceContext } from "@/platform/context";

/**
 * Server-only security helpers that bridge pure platform primitives (permission
 * checks, audit) to the Next.js request layer (header/IP extraction). Platform
 * modules stay free of `next/*` imports — this is the server-side glue.
 *
 * Two concerns live here:
 *   - {@link getClientIp}: single source of truth for the request IP, used by both
 *     auth rate-limit keys and the authz-denial audit row.
 *   - {@link authorizeOrAudit}: the audited twin of `authorize()` — every
 *     permission *denial* on a server boundary is recorded in `audit_logs` so
 *     suspicious / escalation attempts are visible (brief §13).
 */

/**
 * Best-effort client IP for the current request. Falls back through the standard
 * forwarding headers and finally to `"unknown"`. Works in Server Actions, Route
 * Handlers, and server components — `headers()` is request-scoped in all three.
 *
 * `x-forwarded-for` may be a comma-separated client→proxy chain; the first entry
 * is the originating client. With no headers (e.g. local dev, tests) `"unknown"`
 * keeps the rate-limit / audit key stable rather than empty.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Authorize a permission against the resolved workspace context, and — when the
 * check is denied — append an `authz.denied` audit row before returning. This is
 * the variant every server-action / route-handler denial branch should use; the
 * pure `authorize()` (no side effects) stays available for UI gating and
 * `canManage` flag computations (those aren't denials).
 *
 * The audit write is fire-and-forget and never rejects: a logging failure must
 * not change the authorization outcome or surface to the caller. `ctx` carries
 * `workspaceId` + `user.id` (nullable on the audit row) + `role`; the IP is read
 * from the request headers via {@link getClientIp}.
 *
 * Returns the same `PermissionCheckResult` as `authorize()`. The denial reason is
 * always `"insufficient_role"` here — membership existence is resolved upstream
 * by `requireWorkspaceContext` (a non-member never reaches this check).
 */
export async function authorizeOrAudit(
  ctx: WorkspaceContext,
  permission: Permission,
): Promise<PermissionCheckResult> {
  const result = authorize(ctx.role, permission);
  if (!result.ok) {
    const ip = await getClientIp().catch(() => "unknown");
    await auditAuthzDenial({
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      permission,
      reason: result.reason,
      ip,
    }).catch(() => {
      // Best-effort: never let an audit failure alter the authz outcome.
    });
  }
  return result;
}
