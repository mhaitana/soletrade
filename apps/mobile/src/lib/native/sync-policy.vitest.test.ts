import {
  PUSH_REREGISTER_AFTER_MS,
  ROUTE_FULL_SYNC_AFTER_MS,
  ROUTE_SYNC_OVERLAP_MS,
  nextRouteSyncState,
  pushRegistrationDue,
  routeSyncPlan,
} from "@/lib/native/sync-policy";
import { describe, expect, it } from "vitest";
const device = {
  deviceId: "d",
  token: "t",
  timezone: "Australia/Sydney",
  platform: "ios",
  workspaceId: "w",
};
describe("push registration policy", () => {
  const now = 10_000_000_000;
  it("registers when nothing was registered or anything differs", () => {
    expect(pushRegistrationDue(null, device, now)).toBe(true);
    const last = { ...device, registeredAt: now - 1000 };
    expect(pushRegistrationDue(last, { ...device, token: "new" }, now)).toBe(true);
    expect(pushRegistrationDue(last, { ...device, workspaceId: "other" }, now)).toBe(true);
    expect(pushRegistrationDue(last, { ...device, timezone: "UTC" }, now)).toBe(true);
  });
  it("skips an unchanged recent registration and refreshes after seven days", () => {
    expect(pushRegistrationDue({ ...device, registeredAt: now - 1000 }, device, now)).toBe(false);
    expect(
      pushRegistrationDue({ ...device, registeredAt: now - PUSH_REREGISTER_AFTER_MS }, device, now),
    ).toBe(true);
    expect(pushRegistrationDue({ ...device, registeredAt: now + 5 }, device, now)).toBe(true);
  });
});
describe("route reconciliation plan", () => {
  const now = 10_000_000_000;
  it("does a full pass without usable state", () => {
    expect(routeSyncPlan(null, now)).toEqual({ full: true, since: undefined });
    expect(routeSyncPlan({ syncedAt: now + 1, fullAt: now - 5 }, now).full).toBe(true);
    expect(
      routeSyncPlan({ syncedAt: now - 5, fullAt: now - ROUTE_FULL_SYNC_AFTER_MS }, now).full,
    ).toBe(true);
  });
  it("passes an overlapped since timestamp otherwise", () => {
    const plan = routeSyncPlan({ syncedAt: now - 1000, fullAt: now - 2000 }, now);
    expect(plan.full).toBe(false);
    expect(plan.since).toBe(new Date(now - 1000 - ROUTE_SYNC_OVERLAP_MS).toISOString());
  });
  it("only advances the full-pass time after a full pass", () => {
    const state = { syncedAt: 1, fullAt: 1 };
    expect(nextRouteSyncState(state, 50, false)).toEqual({ syncedAt: 50, fullAt: 1 });
    expect(nextRouteSyncState(state, 50, true)).toEqual({ syncedAt: 50, fullAt: 50 });
    expect(nextRouteSyncState(null, 50, false)).toEqual({ syncedAt: 50, fullAt: 50 });
  });
});
