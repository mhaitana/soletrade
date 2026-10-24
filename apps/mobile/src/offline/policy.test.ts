import { describe, expect, it } from "vitest";
import {
  assertBinding,
  nextRetry,
  queueOnce,
  maySyncRoute,
  isQuietHour,
  type QueueEntry,
} from "./policy";
import { summarizePoints, routeSegments, type GPSPoint } from "../native/gps-policy";
const binding = { userId: "user-a", workspaceId: "workspace-a" };
describe("durable outbox policy", () => {
  it("keeps one immutable operation across explicit saves and rejects rebinding", () => {
    const row: QueueEntry = {
      ...binding,
      id: "draft",
      operationId: "stable-operation",
      status: "draft",
      attempts: 0,
    };
    expect(queueOnce(queueOnce(row)).operationId).toBe("stable-operation");
    expect(queueOnce(queueOnce(row)).status).toBe("queued");
    expect(() => assertBinding(row, { ...binding, userId: "user-b" })).toThrow();
    expect(() => assertBinding(row, { ...binding, workspaceId: "workspace-b" })).toThrow();
  });
  it("retains rejected work and backs off transient failures", () => {
    expect(nextRetry(1, "NETWORK", 1000)).toEqual({ status: "queued", nextAttemptAt: 3000 });
    expect(nextRetry(5, "MODULE_DISABLED", 1000)).toEqual({ status: "blocked", nextAttemptAt: 0 });
    expect(nextRetry(5, "UNAUTHENTICATED", 1000).status).toBe("blocked");
  });
});
describe("device privacy policy", () => {
  it("uses device-local quiet hours across midnight", () => {
    expect(isQuietHour(22, 22, 7)).toBe(true);
    expect(isQuietHour(6, 22, 7)).toBe(true);
    expect(isQuietHour(7, 22, 7)).toBe(false);
    expect(isQuietHour(12, 22, 7)).toBe(false);
  });
  it("never syncs routes without opt in and does not resurrect tombstones", () => {
    expect(maySyncRoute(false, false)).toBe(false);
    expect(maySyncRoute(true, true)).toBe(false);
    expect(maySyncRoute(true, false)).toBe(true);
  });
});
describe("GPS continuity", () => {
  const point = (timestamp: number, longitude: number, segment = 0, accuracy = 5): GPSPoint => ({
    timestamp,
    longitude,
    latitude: -37,
    accuracy,
    segment,
  });
  it("counts continuous samples but never bridges pause or missing sample gaps", () => {
    const result = summarizePoints([
      point(0, 144),
      point(10000, 144.001),
      point(600000, 145),
      point(610000, 145.001),
      point(620000, 146, 1),
    ]);
    expect(result.distanceMeters).toBeGreaterThan(150);
    expect(result.distanceMeters).toBeLessThan(200);
    expect(result.gaps).toBe(2);
  });
  it("rejects inaccurate and implausible samples without bridging over them", () => {
    const result = summarizePoints([point(0, 144), point(10000, 145, 0, 200), point(20000, 146)]);
    expect(result.distanceMeters).toBe(0);
    expect(result.gaps).toBeGreaterThan(0);
  });
});

it("draws separate map polylines for pauses and implausible or missing samples", () => {
  const points: GPSPoint[] = [
    { timestamp: 0, latitude: -37, longitude: 144, accuracy: 5, segment: 0 },
    { timestamp: 10000, latitude: -37, longitude: 144.001, accuracy: 5, segment: 0 },
    { timestamp: 20000, latitude: -37, longitude: 145, accuracy: 5, segment: 1 },
    { timestamp: 30000, latitude: -37, longitude: 145.001, accuracy: 5, segment: 1 },
  ];
  expect(routeSegments(points).map((segment) => segment.length)).toEqual([2, 2]);
});
