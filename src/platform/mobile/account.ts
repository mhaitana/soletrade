import "server-only";
import { z } from "zod";
import {
  DEFAULT_MOBILE_PREFERENCES,
  mobilePreferencesSchema,
  type MobilePreferences,
} from "@soletrade/contracts";
import { getDataClient } from "@/server/db/client";
import { getWorkspace, getMembershipRole } from "@/platform/workspaces";
import { can } from "@/platform/permissions";
import { branded, type UserId } from "@/shared/types/ids";
import type { SessionUser } from "@/server/auth/session";
import type { Json } from "@/server/db/types";
import { createNotification } from "@/platform/notifications/store";
import { MobileApiError, requireMobileContext } from "./http";

export async function getMobilePreferences(userId: UserId): Promise<MobilePreferences> {
  const { data, error } = await getDataClient()
    .from("mobile_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Unable to load preferences");
  return data
    ? {
        routeSyncEnabled: data.route_sync_enabled,
        quietHoursStart: data.quiet_hours_start,
        quietHoursEnd: data.quiet_hours_end,
        notificationCategories: data.notification_categories,
      }
    : { ...DEFAULT_MOBILE_PREFERENCES };
}
export async function updateMobilePreferences(userId: UserId, body: unknown) {
  const patch = mobilePreferencesSchema.partial().strict().parse(body);
  const current = await getMobilePreferences(userId);
  const next = { ...current, ...patch };
  const { error } = await getDataClient().from("mobile_preferences").upsert({
    user_id: userId,
    route_sync_enabled: next.routeSyncEnabled,
    quiet_hours_start: next.quietHoursStart,
    quiet_hours_end: next.quietHoursEnd,
    notification_categories: next.notificationCategories,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Unable to save preferences");
  return next;
}

const deviceSchema = z.object({
  deviceId: z.string().min(1).max(200),
  token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/),
  platform: z.enum(["ios", "android"]),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});
export async function registerMobileDevice(userId: UserId, value: unknown) {
  const input = deviceSchema.parse(value);
  const { error } = await getDataClient().rpc("mobile_register_device", {
    p_device_id: input.deviceId,
    p_user_id: userId,
    p_token: input.token,
    p_platform: input.platform,
    p_timezone: input.timezone,
  });
  if (error) throw new Error("Unable to register this device");
  return { registered: true };
}
export async function removeMobileDevice(userId: UserId, id: string) {
  const { error } = await getDataClient()
    .from("mobile_devices")
    .delete()
    .eq("user_id", userId)
    .eq("id", id);
  if (error) throw new Error("Unable to unregister this device");
  return { removed: true };
}

const point = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timestamp: z.number().int().positive(),
  accuracy: z.number().nonnegative().nullable().optional(),
  segment: z.number().int().nonnegative().optional(),
});
const routeSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    tripId: z.uuid(),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    points: z.array(point).max(30_000),
    distanceMeters: z.number().int().nonnegative().max(10_000_000),
  })
  .refine((value) => value.endedAt >= value.startedAt, {
    message: "The route must end after it starts.",
  });
export async function savePrivateRoute(request: Request, userId: UserId, body: unknown) {
  const input = routeSchema.parse(body);
  const ctx = await requireMobileContext(request, input.workspaceId);
  if (!can(ctx.role, "create:drive"))
    throw new MobileApiError("FORBIDDEN", "You cannot record mileage in this workspace.", 403);
  const preferences = await getMobilePreferences(userId);
  if (!preferences.routeSyncEnabled)
    throw new MobileApiError(
      "ROUTE_SYNC_DISABLED",
      "Enable private route syncing before uploading a route.",
      409,
    );
  const db = getDataClient();
  const [{ data: trip, error: tripError }, { data: old, error: oldError }] = await Promise.all([
    db
      .from("drive_trips")
      .select("id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", input.tripId)
      .maybeSingle(),
    db.from("mobile_routes").select("recorder_id,deleted_at").eq("id", input.id).maybeSingle(),
  ]);
  if (tripError || oldError) throw new Error("Unable to verify route ownership");
  if (!trip)
    throw new MobileApiError(
      "TRIP_NOT_FOUND",
      "Save the mileage record before syncing its route.",
      404,
    );
  if (old && (old.recorder_id !== userId || old.deleted_at))
    throw new MobileApiError("ROUTE_UNAVAILABLE", "This route cannot be changed.", 409);
  const { error } = await db.from("mobile_routes").upsert({
    id: input.id,
    recorder_id: userId,
    workspace_id: ctx.workspaceId,
    trip_id: input.tripId,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    distance_meters: input.distanceMeters,
    points: input.points as unknown as Json,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("Unable to save private route");
  return { id: input.id };
}
export async function listPrivateRoutes(userId: UserId, since?: string, cursor?: string) {
  if (since && !z.iso.datetime({ offset: true }).safeParse(since).success)
    throw new MobileApiError("INVALID_CURSOR", "The route sync date is invalid.");
  let query = getDataClient()
    .from("mobile_routes")
    .select("*")
    .eq("recorder_id", userId)
    .order("updated_at")
    .order("id")
    .limit(25);
  if (since) query = query.gt("updated_at", since);
  if (cursor) {
    let decoded: { updatedAt: string; id: string };
    try {
      decoded = z
        .object({ updatedAt: z.iso.datetime({ offset: true }), id: z.uuid() })
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    } catch {
      throw new MobileApiError("INVALID_CURSOR", "The route sync cursor is invalid.");
    }
    query = query.or(
      `updated_at.gt.${decoded.updatedAt},and(updated_at.eq.${decoded.updatedAt},id.gt.${decoded.id})`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error("Unable to load private routes");
  return {
    items: (data ?? [])
      .filter((row) => !row.deleted_at)
      .map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        tripId: row.trip_id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        distanceMeters: row.distance_meters,
        points: row.points,
        updatedAt: row.updated_at,
      })),
    deletedIds: (data ?? []).filter((row) => row.deleted_at).map((row) => row.id),
    nextCursor:
      data?.length === 25
        ? Buffer.from(
            JSON.stringify({ updatedAt: data.at(-1)!.updated_at, id: data.at(-1)!.id }),
          ).toString("base64url")
        : null,
  };
}
export async function deletePrivateRoutes(userId: UserId, id?: string) {
  if (id && !z.uuid().safeParse(id).success)
    throw new MobileApiError("INVALID_ID", "The route identifier is invalid.");
  let query = getDataClient()
    .from("mobile_routes")
    .update({
      points: [],
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("recorder_id", userId);
  if (id) query = query.eq("id", id);
  const { error } = await query;
  if (error) throw new Error("Unable to delete route history");
  return { deleted: true };
}

/** Auth verifies this exact token before these signed AMR timestamps are inspected.
 * Refreshing a token does not refresh the password/OTP authentication timestamp.
 */
export function requireRecentAuthentication(request: Request, now = Date.now()) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  try {
    const claims = JSON.parse(
      Buffer.from(token?.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { amr?: Array<{ method: string; timestamp: number }> };
    if (
      claims.amr?.some(
        (method) =>
          ["password", "otp", "totp", "oauth"].includes(method.method) &&
          method.timestamp * 1000 <= now + 30_000 &&
          now - method.timestamp * 1000 < 600_000,
      )
    )
      return;
  } catch {
    /* Fail closed for missing or malformed authentication evidence. */
  }
  throw new MobileApiError(
    "REAUTHENTICATION_REQUIRED",
    "Sign in again with your password or email link, then confirm account deletion within 10 minutes.",
    403,
  );
}
export async function requestAccountDeletion(request: Request, user: SessionUser, body: unknown) {
  requireRecentAuthentication(request);
  const input = z
    .object({
      confirmation: z.literal("DELETE"),
      closeWorkspaceIds: z.array(z.uuid()).max(100).default([]),
    })
    .parse(body);
  const { data, error } = await getDataClient().rpc("mobile_close_account", {
    p_user_id: user.id,
    p_close_workspaces: input.closeWorkspaceIds,
  });
  if (error)
    throw new MobileApiError(
      "OWNED_WORKSPACES_REMAIN",
      "Transfer ownership or explicitly close every workspace you own before deleting your account.",
      409,
    );
  // Immediate application revocation is enforced by public.users.deleted_at. Ban also
  // prevents new Auth sessions while irreversible purge is waiting for its scheduled date.
  const result = await getDataClient().auth.admin.updateUserById(user.id, {
    ban_duration: "876000h",
  });
  if (result.error) console.error("Auth closure revocation pending", { kind: result.error.name });
  return data;
}

export async function ownershipTransfers(userId: UserId) {
  const { data, error } = await getDataClient()
    .from("workspace_ownership_transfers")
    .select("*")
    .eq("to_user_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  if (error) throw new Error("Unable to load ownership transfers");
  return { items: data ?? [] };
}
export async function requestOwnershipTransfer(user: SessionUser, body: unknown) {
  const input = z.object({ workspaceId: z.uuid(), toUserId: z.uuid() }).parse(body);
  const workspaceId = branded<"WorkspaceId">(input.workspaceId);
  const [workspace, recipient] = await Promise.all([
    getWorkspace(workspaceId),
    getMembershipRole(workspaceId, branded<"UserId">(input.toUserId)),
  ]);
  if (
    !workspace ||
    workspace.ownerId !== user.id ||
    workspace.deletedAt ||
    !recipient ||
    input.toUserId === user.id
  )
    throw new MobileApiError(
      "INVALID_TRANSFER",
      "Choose an existing member of a workspace you own.",
      403,
    );
  const { data, error } = await getDataClient()
    .from("workspace_ownership_transfers")
    .insert({ workspace_id: workspaceId, from_user_id: user.id, to_user_id: input.toUserId })
    .select("id")
    .single();
  if (error) throw new Error("Unable to request ownership transfer");
  await createNotification({
    workspaceId,
    userId: branded<"UserId">(input.toUserId),
    type: "workspace.transfer.requested",
    title: "Workspace ownership transfer",
    body: "You have been invited to take ownership of this workspace. Review the request in account settings.",
    entityType: "workspace_transfer",
    entityId: data.id,
  });
  return data;
}
export async function acceptOwnershipTransfer(userId: UserId, id: string) {
  z.uuid().parse(id);
  const { data, error } = await getDataClient().rpc("mobile_accept_transfer", {
    p_id: id,
    p_user_id: userId,
  });
  if (error)
    throw new MobileApiError(
      "TRANSFER_UNAVAILABLE",
      "This transfer is expired, or ownership or membership has changed.",
      409,
    );
  return { workspaceId: data };
}
