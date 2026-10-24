import { summarizePoints } from "@/lib/native/gps-policy";
import {
  applyRouteTombstones,
  changeShift,
  continueManualShift,
  currentShift,
  deletePrivateRoute,
  listPrivateRouteHistory,
  privateRouteDetails,
  reconcileRouteDeletions,
  recoverShift,
  saveReviewedShift,
  startShift,
  suspendShiftForLogout,
} from "@/lib/native/shift";
import { beforeEach, describe, expect, it, vi } from "vitest";
const data = vi.hoisted(() => ({
  states: new Map<string, unknown>(),
  drafts: new Map<string, unknown>(),
  counter: 0,
  started: false,
  permissionAllowed: true,
  task: null as null | ((value: unknown) => Promise<void>),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `session-${++data.counter}` }));
vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, task: (value: unknown) => Promise<void>) => {
    data.task = task;
  },
}));
vi.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: async () => ({ granted: data.permissionAllowed }),
  requestBackgroundPermissionsAsync: async () => ({ granted: true }),
  startLocationUpdatesAsync: async () => {
    data.started = true;
  },
  stopLocationUpdatesAsync: async () => {
    data.started = false;
  },
  hasStartedLocationUpdatesAsync: async () => data.started,
}));
vi.mock("@/lib/offline/store", () => ({
  readState: async (key: string) => structuredClone(data.states.get(key) ?? null),
  writeState: async (key: string, value: unknown) => {
    data.states.set(key, structuredClone(value));
  },
  deleteState: async (key: string) => {
    data.states.delete(key);
  },
  listState: async (prefix: string) =>
    [...data.states]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: structuredClone(value) })),
  createDraft: async (input: { id: string }) => {
    if (!data.drafts.has(input.id)) data.drafts.set(input.id, structuredClone(input));
    return data.drafts.get(input.id);
  },
  explicitSave: async () => {},
  listDrafts: async () => [...data.drafts.values()],
  nativeOperation: async () => `native-${++data.counter}`,
}));
const a = { userId: "a", workspaceId: "one" },
  b = { userId: "b", workspaceId: "two" };
const locations = (timestamp: number, longitude: number) => ({
  data: { locations: [{ timestamp, coords: { latitude: -37, longitude, accuracy: 5 } }] },
});
beforeEach(() => {
  data.states.clear();
  data.drafts.clear();
  data.counter = 0;
  data.started = false;
  data.permissionAllowed = true;
});
describe("shift lifecycle binding and deletion", () => {
  it("retains each account/workspace shift without allowing overlapping recordings", async () => {
    const first = await startShift(a, "uber", "vehicle-a", true);
    await changeShift(a, "pause");
    const second = await startShift(b, "other", "vehicle-b", true);
    expect((await currentShift(a))?.id).toBe(first.id);
    expect((await currentShift(b))?.id).toBe(second.id);
    await expect(changeShift(a, "resume")).rejects.toThrow("other recording");
    await suspendShiftForLogout(b.userId);
    await changeShift(a, "resume");
    expect((await currentShift(a))?.status).toBe("recording");
  });
  it("excludes paused travel and produces one stable reviewed operation", async () => {
    await startShift(a, "uber", "vehicle-a");
    await data.task!(locations(1000, 144));
    await data.task!(locations(11000, 144.001));
    await changeShift(a, "pause");
    await changeShift(a, "resume");
    await data.task!(locations(21000, 145));
    await changeShift(a, "stop");
    const shift = await currentShift(a),
      summary = summarizePoints(shift!.points);
    expect(summary.distanceMeters).toBeLessThan(100);
    expect(summary.gaps).toBe(1);
    const first = await saveReviewedShift(a, 2000, "Deliveries");
    const second = await saveReviewedShift(a, 2000, "Deliveries");
    expect(first.id).toBe(second.id);
    expect(data.drafts.size).toBe(1);
  });
  it("keeps a deletion tombstone offline and rejects later OS samples", async () => {
    const shift = await startShift(a, "uber", "vehicle-a");
    await data.task!(locations(1000, 144));
    await expect(
      deletePrivateRoute(a, vi.fn().mockRejectedValue(new Error("Offline"))),
    ).rejects.toThrow("Offline");
    const deleted = await currentShift(a);
    expect(deleted).toMatchObject({ routeDeleted: true, status: "review", points: [] });
    expect(data.states.get(`route-tombstone:a:${shift.id}`)).toBe(true);
    await data.task!(locations(11000, 145));
    expect((await currentShift(a))?.points).toEqual([]);
    expect(data.started).toBe(false);
  });
});

describe("cross-device private route archive", () => {
  it("downloads recorder-bound history without creating a recording and never resurrects tombstoned points", async () => {
    const id = "remote-route";
    const record = {
      id,
      workspaceId: a.workspaceId,
      tripId: "trip",
      startedAt: "2026-10-25T01:00:00Z",
      endedAt: "2026-10-25T02:00:00Z",
      distanceMeters: 5000,
      updatedAt: "2026-10-25T02:00:00Z",
      points: [
        { latitude: -37, longitude: 144, timestamp: 1000, accuracy: 5, segment: 0 },
        { latitude: -37, longitude: 144.001, timestamp: 11000, accuracy: 5, segment: 1 },
      ],
    };
    const request = vi.fn().mockResolvedValue({ items: [record], deletedIds: [] });
    await reconcileRouteDeletions(a, request);
    expect(await currentShift(a)).toBeNull();
    expect(await listPrivateRouteHistory(a)).toMatchObject([
      { id, remote: true, distanceMeters: 5000 },
    ]);
    expect(await privateRouteDetails(a, id)).toMatchObject({
      distanceMeters: 5000,
      points: record.points,
    });
    expect(await listPrivateRouteHistory(b)).toEqual([]);
    await expect(privateRouteDetails(b, id)).rejects.toThrow("not found");
    await applyRouteTombstones(a, [id]);
    await reconcileRouteDeletions(a, request);
    await expect(privateRouteDetails(a, id)).rejects.toThrow("deleted");
    expect(data.states.get("remote-route:a:remote-route")).toMatchObject({
      points: [],
      deleted: true,
    });
  });
});

describe("actual shift interruption counters", () => {
  it("counts an OS interruption once and excludes intentional pause/resume from health events", async () => {
    await startShift(a, "uber", "vehicle-a");
    await changeShift(a, "pause");
    expect((await currentShift(a))?.recordingInterruptions ?? 0).toBe(0);
    await changeShift(a, "resume");
    data.started = false;
    await recoverShift(a);
    expect(await currentShift(a)).toMatchObject({ status: "paused", recordingInterruptions: 1 });
    await recoverShift(a);
    expect((await currentShift(a))?.recordingInterruptions).toBe(1);
    await changeShift(a, "resume");
    await changeShift(a, "pause");
    expect((await currentShift(a))?.recordingInterruptions).toBe(1);
  });
  it("records real permission denial/revocation and retains manual fallback without counting normal actions", async () => {
    data.permissionAllowed = false;
    await expect(startShift(a, "uber", "vehicle-a")).rejects.toThrow("permission");
    expect(await currentShift(a)).toMatchObject({ status: "paused", permissionInterruptions: 1 });
    await continueManualShift(a);
    await changeShift(a, "stop");
    expect((await currentShift(a))?.permissionInterruptions).toBe(1);
    data.permissionAllowed = true;
    await startShift(b, "other", "vehicle-b");
    await data.task!({ error: { code: "E_LOCATION_UNAUTHORIZED", message: "Permission revoked" } });
    expect(await currentShift(b)).toMatchObject({ status: "paused", permissionInterruptions: 1 });
    expect(data.started).toBe(false);
  });
});
