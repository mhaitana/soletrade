import { summarizePoints, type GPSPoint } from "@/lib/native/gps-policy";
import { assertBinding, maySyncRoute } from "@/lib/offline/policy";
import {
  createDraft,
  deleteState,
  explicitSave,
  listDrafts,
  listState,
  nativeOperation,
  readState,
  writeState,
  type Binding,
} from "@/lib/offline/store";
import type { MobileRequest } from "@soletrade/contracts";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
export const SHIFT_TASK = "soletrade-user-started-shift-v1";
export interface ShiftSession extends Binding {
  id: string;
  operationId: string;
  platform: string;
  vehicleId: string;
  status: "recording" | "paused" | "review" | "saved";
  startedAt: number;
  stoppedAt?: number;
  segment: number;
  points: GPSPoint[];
  manual: boolean;
  error?: string;
  recordingInterruptions?: number;
  permissionInterruptions?: number;
  lastInterruptionAt?: number;
  draftId?: string;
  routeDeleted?: boolean;
}
class ShiftPermissionError extends Error {}
function recordInterruption(shift: ShiftSession, error?: unknown) {
  const code = String((error as { code?: unknown } | undefined)?.code ?? "").toUpperCase();
  if (error instanceof ShiftPermissionError || /PERMISSION|UNAUTHORIZED|DENIED/.test(code))
    shift.permissionInterruptions = (shift.permissionInterruptions ?? 0) + 1;
  else shift.recordingInterruptions = (shift.recordingInterruptions ?? 0) + 1;
  shift.lastInterruptionAt = Date.now();
}
let writes = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work);
  writes = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
async function active() {
  const id = await readState<string>("active-shift");
  return id ? readState<ShiftSession>(`shift:${id}`) : null;
}
export async function currentShift(binding: Binding) {
  const id = await readState<string>(`active-shift:${binding.userId}:${binding.workspaceId}`);
  const shift = id ? await readState<ShiftSession>(`shift:${id}`) : null;
  if (shift) assertBinding(shift, binding);
  return shift;
}
async function persist(shift: ShiftSession) {
  await writeState(`shift:${shift.id}`, shift);
}
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  SHIFT_TASK,
  async ({ data, error }) => {
    await serial(async () => {
      const shift = await active();
      if (!shift || shift.status !== "recording" || shift.routeDeleted) return;
      if (error) {
        shift.error = error.message;
        shift.status = "paused";
        shift.segment++;
        recordInterruption(shift, error);
        await persist(shift);
        await endGPS();
        return;
      }
      for (const point of data?.locations ?? []) {
        // Drop replayed/out-of-order OS batches; never bridge the rejected point.
        if (point.timestamp <= (shift.points.at(-1)?.timestamp ?? -1)) continue;
        shift.points.push({
          timestamp: point.timestamp,
          latitude: point.coords.latitude,
          longitude: point.coords.longitude,
          accuracy: point.coords.accuracy ?? -1,
          segment: shift.segment,
        });
      }
      await persist(shift);
    });
  },
);
async function beginGPS() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted)
    throw new ShiftPermissionError(
      "Location permission denied. Use manual distance recording or enable location in Settings.",
    );
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted)
    throw new ShiftPermissionError(
      "Background location permission is required for a GPS shift. Manual recording is available.",
    );
  await Location.startLocationUpdatesAsync(SHIFT_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    timeInterval: 10000,
    deferredUpdatesInterval: 10000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Soletrade shift recording",
      notificationBody: "Location is recording for your shift. Open Soletrade to pause or stop.",
    },
  });
}
async function endGPS() {
  if (await Location.hasStartedLocationUpdatesAsync(SHIFT_TASK))
    await Location.stopLocationUpdatesAsync(SHIFT_TASK);
}
export async function startShift(
  binding: Binding,
  platform: string,
  vehicleId: string,
  manual = false,
) {
  if (!platform.trim() || !vehicleId.trim())
    throw new Error("Select a platform and vehicle before starting.");
  return serial(async () => {
    const old = await currentShift(binding);
    const recording = await active();
    if (recording?.status === "recording")
      throw new Error("Pause or stop the recording shift before starting another.");
    if (old && old.status !== "saved")
      throw new Error("Finish reviewing the existing shift before starting another.");
    const shift: ShiftSession = {
      ...binding,
      id: Crypto.randomUUID(),
      operationId: Crypto.randomUUID(),
      platform,
      vehicleId,
      status: "paused",
      startedAt: Date.now(),
      segment: 0,
      points: [],
      manual,
    };
    await persist(shift);
    await writeState("active-shift", shift.id);
    await writeState(`active-shift:${binding.userId}:${binding.workspaceId}`, shift.id);
    if (!manual) {
      try {
        await beginGPS();
      } catch (error) {
        shift.error = (error as Error).message;
        recordInterruption(shift, error);
        await persist(shift);
        throw error;
      }
    }
    shift.status = "recording";
    await persist(shift);
    return shift;
  });
}
export async function changeShift(binding: Binding, action: "pause" | "resume" | "stop") {
  return serial(async () => {
    const shift = await currentShift(binding);
    if (!shift) throw new Error("No active shift.");
    if (action === "resume") {
      if (shift.status !== "paused") throw new Error("Only paused shifts can resume.");
      if (shift.routeDeleted)
        throw new Error(
          "This route was deleted. Stop and review this shift before recording a new one.",
        );
      const recording = await active();
      if (recording?.status === "recording" && recording.id !== shift.id)
        throw new Error("Pause the other recording shift first.");
      shift.segment++;
      await writeState("active-shift", shift.id);
      if (!shift.manual)
        try {
          await beginGPS();
        } catch (error) {
          shift.error = (error as Error).message;
          recordInterruption(shift, error);
          await persist(shift);
          throw error;
        }
      shift.status = "recording";
      shift.error = undefined;
    } else {
      // Persist the paused/stopped state before asking the OS to stop callbacks.
      shift.status = action === "stop" ? "review" : "paused";
      shift.segment++;
      if (action === "stop") shift.stoppedAt = Date.now();
      await persist(shift);
      if ((await readState<string>("active-shift")) === shift.id) await endGPS();
    }
    await persist(shift);
    return shift;
  });
}
export async function recoverShift(binding: Binding) {
  return serial(async () => {
    const shift = await currentShift(binding);
    if (!shift) return null;
    if (
      shift.status === "recording" &&
      !shift.manual &&
      !(await Location.hasStartedLocationUpdatesAsync(SHIFT_TASK))
    ) {
      shift.status = "paused";
      shift.segment++;
      shift.error = "Recording was interrupted. Review missing distance, then resume or stop.";
      recordInterruption(shift);
      await persist(shift);
    }
    return shift;
  });
}
export async function saveReviewedShift(binding: Binding, distanceMeters: number, purpose: string) {
  return serial(async () => {
    const shift = await currentShift(binding);
    if (!shift || !["review", "saved"].includes(shift.status))
      throw new Error("Stop the shift and review it before saving.");
    if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0 || !purpose.trim())
      throw new Error("Enter a valid reviewed distance and business purpose.");
    const summary = summarizePoints(shift.points);
    const draft = await createDraft({
      ...binding,
      id: shift.id,
      operationId: shift.operationId,
      kind: "reviewed-shift",
      path: `/workspaces/${binding.workspaceId}/drive/trips`,
      body: {
        platform: shift.platform,
        vehicleId: shift.vehicleId,
        date: new Date(shift.startedAt).toISOString().slice(0, 10),
        distanceMeters,
        purpose,
        notes: `Reviewed shift ${shift.id}; measured ${summary.distanceMeters} m; ${summary.gaps} gaps. ${shift.manual ? "Manual distance." : ""}`,
      },
    });
    await explicitSave(binding, draft.id);
    shift.draftId = draft.id;
    shift.status = "saved";
    await persist(shift);
    return draft;
  });
}
export async function syncPrivateRoute(
  binding: Binding,
  request: MobileRequest,
  optedIn: boolean,
  shiftId?: string,
) {
  await reconcileRouteDeletions(binding, request);
  const shift = shiftId
    ? await readState<ShiftSession>(`shift:${shiftId}`)
    : await currentShift(binding);
  if (shift) assertBinding(shift, binding);
  if (
    !shift ||
    !maySyncRoute(
      optedIn,
      !!shift.routeDeleted || !!(await readState(`route-deleted:${binding.userId}:${shift.id}`)),
    )
  )
    throw new Error("Route sync is off or this route was deleted.");
  const draft = (await listDrafts(binding)).find((item) => item.id === shift.draftId);
  if (!draft?.resultId || draft.status !== "synced" || !shift.stoppedAt)
    throw new Error("Save and sync the reviewed mileage before syncing its private route.");
  await request("/me/routes", {
    method: "POST",
    idempotencyKey: await nativeOperation(binding.userId, `${shift.id}:route`),
    body: {
      id: shift.id,
      workspaceId: binding.workspaceId,
      tripId: draft.resultId,
      points: shift.points.map(({ latitude, longitude, timestamp, accuracy, segment }) => ({
        latitude,
        longitude,
        timestamp,
        accuracy,
        segment,
      })),
      startedAt: new Date(shift.startedAt).toISOString(),
      endedAt: new Date(shift.stoppedAt).toISOString(),
      distanceMeters: Number(draft.body.distanceMeters),
    },
  });
}
export async function deletePrivateRoute(
  binding: Binding,
  request: MobileRequest,
  routeId?: string,
) {
  const deletedId = await serial(async () => {
    const local = routeId
      ? await readState<ShiftSession>(`shift:${routeId}`)
      : await currentShift(binding);
    const id = local?.id ?? routeId;
    if (!id) return null;
    const archive = await readState<PrivateRouteArchive>(`remote-route:${binding.userId}:${id}`);
    if (local) assertBinding(local, binding);
    if (archive) assertBinding(archive, binding);
    if (!local && !archive) return null;
    await writeState(`route-deleted:${binding.userId}:${id}`, true);
    await writeState(`route-tombstone:${binding.userId}:${id}`, true);
    if (local) {
      local.routeDeleted = true;
      local.points = [];
      if (local.status === "recording" || local.status === "paused") {
        local.status = "review";
        local.stoppedAt = Date.now();
        local.segment++;
      }
      await persist(local);
      if ((await readState<string>("active-shift")) === id) await endGPS();
    }
    if (archive) {
      archive.points = [];
      archive.deleted = true;
      await writeState(`remote-route:${binding.userId}:${id}`, archive);
    }
    return id;
  });
  if (!deletedId) return;
  await request(`/me/routes/${deletedId}`, {
    method: "DELETE",
    idempotencyKey: await nativeOperation(binding.userId, `${deletedId}:delete-route`),
  });
  await deleteState(`route-tombstone:${binding.userId}:${deletedId}`);
}

export async function applyRouteTombstones(binding: Binding, ids: string[]) {
  await serial(async () => {
    for (const id of ids) {
      const shift = await readState<ShiftSession>(`shift:${id}`);
      if (shift && shift.userId === binding.userId) {
        shift.routeDeleted = true;
        shift.points = [];
        if (shift.status === "recording" || shift.status === "paused") {
          shift.status = "review";
          shift.stoppedAt = Date.now();
          shift.segment++;
        }
        await persist(shift);
        if ((await readState<string>("active-shift")) === shift.id) await endGPS();
      }
      const archive = await readState<PrivateRouteArchive>(`remote-route:${binding.userId}:${id}`);
      if (archive) {
        archive.points = [];
        archive.deleted = true;
        await writeState(`remote-route:${binding.userId}:${id}`, archive);
      }
      await writeState(`route-deleted:${binding.userId}:${id}`, true);
    }
  });
}
export async function suspendShiftForLogout(userId: string) {
  const shift = await active();
  if (shift?.userId === userId && shift.status === "recording") await changeShift(shift, "pause");
}
export async function continueManualShift(binding: Binding) {
  return serial(async () => {
    const shift = await currentShift(binding);
    if (!shift || shift.status !== "paused") throw new Error("Pause the shift first.");
    const recording = await active();
    if (recording?.status === "recording" && recording.id !== shift.id)
      throw new Error("Pause the other recording shift first.");
    await writeState("active-shift", shift.id);
    shift.manual = true;
    shift.status = "recording";
    shift.segment++;
    shift.error = undefined;
    await endGPS();
    await persist(shift);
    return shift;
  });
}

export async function listPrivateShifts(binding: Binding) {
  return (await listState<ShiftSession>("shift:"))
    .map((row) => row.value)
    .filter(
      (shift) => shift.userId === binding.userId && shift.workspaceId === binding.workspaceId,
    );
}
export async function reconcileRouteDeletions(binding: Binding, request: MobileRequest) {
  let cursor: string | null | undefined;
  do {
    const remote: {
      items?: RemotePrivateRoute[];
      deletedIds: string[];
      nextCursor?: string | null;
    } = await request(`/me/routes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
    await applyRouteTombstones(binding, remote.deletedIds ?? []);
    await serial(async () => {
      for (const item of remote.items ?? []) {
        if (await readState(`route-deleted:${binding.userId}:${item.id}`)) continue;
        const key = `remote-route:${binding.userId}:${item.id}`,
          existing = await readState<PrivateRouteArchive>(key);
        if (
          existing &&
          (existing.userId !== binding.userId || existing.workspaceId !== item.workspaceId)
        )
          throw new Error("A synced route cannot move between accounts or workspaces.");
        await writeState(key, {
          ...item,
          userId: binding.userId,
          source: "remote",
          deleted: false,
        } satisfies PrivateRouteArchive);
      }
    });
    cursor = remote.nextCursor;
  } while (cursor);
  for (const row of await listState<boolean>(`route-tombstone:${binding.userId}:`)) {
    const id = row.key.split(":").at(-1)!;
    await request(`/me/routes/${id}`, {
      method: "DELETE",
      idempotencyKey: await nativeOperation(binding.userId, `${id}:delete-route`),
    });
    await deleteState(row.key);
  }
}
export async function discardPrivateDeviceData(userId: string) {
  await suspendShiftForLogout(userId);
  for (const row of await listState<PrivateRouteArchive>(`remote-route:${userId}:`)) {
    row.value.points = [];
    row.value.deleted = true;
    await writeState(row.key, row.value);
    await writeState(`route-deleted:${userId}:${row.value.id}`, true);
  }
  const shifts = await listState<ShiftSession>("shift:");
  for (const row of shifts)
    if (row.value.userId === userId) {
      row.value.points = [];
      row.value.routeDeleted = true;
      await persist(row.value);
    }
}

interface RemotePrivateRoute {
  id: string;
  workspaceId: string;
  tripId: string;
  startedAt: string;
  endedAt: string;
  distanceMeters: number;
  points: {
    latitude: number;
    longitude: number;
    timestamp: number;
    accuracy?: number | null;
    segment?: number;
  }[];
  updatedAt: string;
}
interface PrivateRouteArchive extends RemotePrivateRoute {
  userId: string;
  source: "remote";
  deleted: boolean;
}
export interface PrivateRouteHistory {
  id: string;
  startedAt: number;
  pointCount: number;
  deleted: boolean;
  remote: boolean;
  distanceMeters: number;
}
export async function listPrivateRouteHistory(binding: Binding): Promise<PrivateRouteHistory[]> {
  const local = await listPrivateShifts(binding),
    ids = new Set(local.map((shift) => shift.id));
  const remote = (await listState<PrivateRouteArchive>(`remote-route:${binding.userId}:`))
    .map((row) => row.value)
    .filter(
      (route) =>
        route.userId === binding.userId &&
        route.workspaceId === binding.workspaceId &&
        !ids.has(route.id),
    );
  return [
    ...local.map((shift) => ({
      id: shift.id,
      startedAt: shift.startedAt,
      pointCount: shift.points.length,
      deleted: !!shift.routeDeleted,
      remote: false,
      distanceMeters: summarizePoints(shift.points).distanceMeters,
    })),
    ...remote.map((route) => ({
      id: route.id,
      startedAt: new Date(route.startedAt).getTime(),
      pointCount: route.points.length,
      deleted: route.deleted,
      remote: true,
      distanceMeters: route.distanceMeters,
    })),
  ].sort((a, b) => b.startedAt - a.startedAt);
}
export async function privateRouteDetails(binding: Binding, id: string) {
  const local = await readState<ShiftSession>(`shift:${id}`);
  if (local) {
    assertBinding(local, binding);
    if (local.routeDeleted) throw new Error("This precise route was deleted.");
    const draft = (await listDrafts(binding)).find((row) => row.id === local.draftId);
    return {
      points: local.points,
      distanceMeters: Number(
        draft?.body.distanceMeters ?? summarizePoints(local.points).distanceMeters,
      ),
      startedAt: local.startedAt,
      endedAt: local.stoppedAt,
    };
  }
  const remote = await readState<PrivateRouteArchive>(`remote-route:${binding.userId}:${id}`);
  if (!remote) throw new Error("Private route not found on this device.");
  assertBinding(remote, binding);
  if (remote.deleted) throw new Error("This precise route was deleted.");
  return {
    points: remote.points.map((point) => ({
      ...point,
      accuracy: point.accuracy ?? 0,
      segment: point.segment ?? 0,
    })),
    distanceMeters: remote.distanceMeters,
    startedAt: new Date(remote.startedAt).getTime(),
    endedAt: new Date(remote.endedAt).getTime(),
  };
}
