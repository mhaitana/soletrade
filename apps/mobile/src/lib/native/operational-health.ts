import { listDrafts, readState, writeState, type Binding } from "@/lib/offline/store";
import {
  mobileHealthReportSchema,
  type MobileHealthEvent,
  type MobileRequest,
} from "@soletrade/contracts";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

type HealthState = { userId: string; events: MobileHealthEvent[]; seen: string[] };
type ShiftHealth = Binding & {
  id: string;
  segment?: number;
  status?: string;
  error?: string;
  manual?: boolean;
  recordingInterruptions?: number;
  permissionInterruptions?: number;
};
const observations = new Map<string, Promise<void>>();

/** Best-effort operational counters only. All identifying signatures stay on this device. */
export async function observeOperationalHealth(
  binding: Binding,
  request: MobileRequest,
): Promise<void> {
  if (!binding.userId || !binding.workspaceId || !["ios", "android"].includes(Platform.OS)) return;
  const pending = observations.get(binding.userId);
  if (pending) return pending;
  const work = observe(binding, request).catch(() => undefined);
  observations.set(binding.userId, work);
  try {
    await work;
  } finally {
    if (observations.get(binding.userId) === work) observations.delete(binding.userId);
  }
}
async function observe(binding: Binding, request: MobileRequest) {
  const key = `operational-health:${binding.userId}`;
  const saved = await readState<HealthState>(key);
  const owned = saved?.userId === binding.userId ? saved : null;
  // Rebuild the wire records explicitly; extra local properties can never be transmitted.
  const events: MobileHealthEvent[] = [];
  for (const candidate of Array.isArray(owned?.events) ? owned.events.slice(0, 20) : []) {
    const result = mobileHealthReportSchema.safeParse({
      events: [
        {
          eventId: candidate.eventId,
          kind: candidate.kind,
          reason: candidate.reason,
          platform: candidate.platform,
        },
      ],
    });
    if (result.success) events.push(result.data.events[0]);
  }
  const seen = (Array.isArray(owned?.seen) ? owned.seen : [])
    .filter((value): value is string => typeof value === "string")
    .slice(-100);
  const add = (
    signature: string,
    kind: MobileHealthEvent["kind"],
    reason: MobileHealthEvent["reason"],
  ) => {
    if (events.length >= 20 || seen.includes(signature)) return;
    events.push({
      eventId: Crypto.randomUUID(),
      kind,
      reason,
      platform: Platform.OS as "ios" | "android",
    });
    seen.push(signature);
    if (seen.length > 100) seen.shift();
  };
  for (const draft of await listDrafts(binding)) {
    if (draft.userId !== binding.userId || draft.workspaceId !== binding.workspaceId) continue;
    if (
      draft.status !== "blocked" &&
      !(draft.status === "queued" && draft.attempts > 0 && draft.error)
    )
      continue;
    add(
      `sync:${draft.workspaceId}:${draft.id}:${draft.operationId}:${draft.status}:${draft.attempts}`,
      "sync_failure",
      draft.status === "blocked" ? "blocked" : "retryable",
    );
  }
  const shiftId = await readState<string>(`active-shift:${binding.userId}:${binding.workspaceId}`);
  const shift = shiftId ? await readState<ShiftHealth>(`shift:${shiftId}`) : null;
  if (
    shift &&
    shift.userId === binding.userId &&
    shift.workspaceId === binding.workspaceId &&
    !shift.manual
  ) {
    for (const [field, reason] of [
      ["recordingInterruptions", "interrupted"],
      ["permissionInterruptions", "permission"],
    ] as const) {
      const count = shift[field];
      if (typeof count === "number" && Number.isSafeInteger(count) && count > 0)
        add(`recording:${shift.id}:${field}:${count}`, "recording_interruption", reason);
    }
    // Legacy sessions predate dedicated counters; identify their known paused error once.
    if (
      shift.recordingInterruptions === undefined &&
      shift.permissionInterruptions === undefined &&
      shift.status === "paused" &&
      shift.error
    ) {
      const reason = /permission/i.test(shift.error)
        ? "permission"
        : /interrupt/i.test(shift.error)
          ? "interrupted"
          : null;
      if (reason)
        add(
          `recording:${shift.id}:legacy:${shift.segment ?? 0}:${reason}`,
          "recording_interruption",
          reason,
        );
    }
  }
  const state: HealthState = { userId: binding.userId, events, seen };
  await writeState(key, state);
  if (!events.length) return;
  const body = mobileHealthReportSchema.parse({ events });
  const result = await request<{ accepted: boolean }>("/me/health", { method: "POST", body });
  if (result?.accepted === true) await writeState(key, { ...state, events: [] });
}
