export interface Binding {
  userId: string;
  workspaceId: string;
}
export interface QueueEntry extends Binding {
  id: string;
  operationId: string;
  status: "draft" | "queued" | "sending" | "blocked" | "synced";
  attempts: number;
}
export function assertBinding(row: Binding, binding: Binding) {
  if (row.userId !== binding.userId || row.workspaceId !== binding.workspaceId)
    throw new Error("This work belongs to another account or workspace.");
}
export function queueOnce<T extends QueueEntry>(row: T): T {
  return row.status === "draft" ? { ...row, status: "queued" } : row;
}
export function nextRetry(
  attempts: number,
  code: string,
  now = Date.now(),
): { status: "blocked" | "queued"; nextAttemptAt: number } {
  const permanent =
    /AUTH|FORBIDDEN|MEMBERSHIP|MODULE|SUSPEND|VALIDATION|BAD_REQUEST|CONFLICT|NOT_FOUND|400|401|403|404|409|410|422/.test(
      code,
    );
  return permanent
    ? { status: "blocked", nextAttemptAt: 0 }
    : {
        status: "queued",
        nextAttemptAt: now + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)),
      };
}
export function isQuietHour(hour: number, start = 22, end = 7) {
  return start === end
    ? false
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}
export function maySyncRoute(optedIn: boolean, tombstoned: boolean) {
  return optedIn && !tombstoned;
}
