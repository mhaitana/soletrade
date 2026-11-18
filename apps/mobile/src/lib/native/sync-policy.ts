/** Pure policies that keep foreground sync from repeating work the server already has. */
export const PUSH_REREGISTER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export interface PushRegistration {
  deviceId: string;
  token: string;
  timezone: string;
  platform: string;
  workspaceId: string;
  registeredAt: number;
}
/** Register when nothing was registered, the device/token/binding changed, or it is stale. */
export function pushRegistrationDue(
  last: PushRegistration | null | undefined,
  next: Omit<PushRegistration, "registeredAt">,
  now: number,
) {
  if (!last) return true;
  if (
    last.deviceId !== next.deviceId ||
    last.token !== next.token ||
    last.timezone !== next.timezone ||
    last.platform !== next.platform ||
    last.workspaceId !== next.workspaceId
  )
    return true;
  // A clock that moved backwards cannot prove the registration is still fresh.
  return last.registeredAt > now || now - last.registeredAt >= PUSH_REREGISTER_AFTER_MS;
}

/**
 * Route reconciliation asks the server for rows changed since the last successful pass. Server
 * tombstones update `updated_at`, so deletions arrive in the incremental window. The overlap
 * absorbs clock skew between this device and the server; replaying a route is idempotent. A full
 * pass is still made first, after a clock rollback, and weekly.
 */
export const ROUTE_SYNC_OVERLAP_MS = 60 * 60 * 1000;
export const ROUTE_FULL_SYNC_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export interface RouteSyncState {
  /** Start time of the last successful pass. */
  syncedAt: number;
  /** Start time of the last successful full pass. */
  fullAt: number;
}
export function routeSyncPlan(state: RouteSyncState | null | undefined, now: number) {
  if (
    !state ||
    state.syncedAt > now ||
    state.fullAt > now ||
    now - state.fullAt >= ROUTE_FULL_SYNC_AFTER_MS
  )
    return { full: true as const, since: undefined };
  return {
    full: false as const,
    since: new Date(state.syncedAt - ROUTE_SYNC_OVERLAP_MS).toISOString(),
  };
}
export function nextRouteSyncState(
  previous: RouteSyncState | null | undefined,
  startedAt: number,
  full: boolean,
): RouteSyncState {
  return { syncedAt: startedAt, fullAt: full || !previous ? startedAt : previous.fullAt };
}
