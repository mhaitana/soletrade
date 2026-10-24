import type { MobileRequest, MobileStoreIntent } from "@soletrade/contracts";
export interface LocalStoreIntent {
  userId: string;
  workspaceId: string;
  provider: "apple" | "google";
  offerKey: string;
  productId: string;
  operationId: string;
  intentId?: string;
  launchedLocally?: boolean;
  phase: "prepared" | "reserved" | "opened" | "uncertain" | "purchased" | "verified" | "canceled";
}
export type StoreFailureSource = "provider" | "preflight" | "verification" | "unknown";
export function resumeStoreIntent<T extends LocalStoreIntent>(previous: T | null, desired: T): T {
  if (!previous || previous.phase === "canceled" || previous.phase === "verified") return desired;
  if (previous.userId !== desired.userId || previous.workspaceId !== desired.workspaceId)
    throw new Error("Resume the purchase in its original account and workspace.");
  if (
    previous.provider !== desired.provider ||
    previous.offerKey !== desired.offerKey ||
    previous.productId !== desired.productId
  )
    throw new Error("Resume or restore the existing purchase before selecting another plan.");
  return { ...desired, ...previous };
}
export function uncertainStoreIntent<T extends LocalStoreIntent>(intent: T): T {
  return ["prepared", "reserved", "verified", "purchased", "canceled"].includes(intent.phase)
    ? intent
    : { ...intent, phase: "uncertain" };
}
export function shouldCancelStoreIntent(
  intent: LocalStoreIntent | null | undefined,
  source: StoreFailureSource,
  code: unknown,
) {
  return (
    !!intent?.intentId &&
    intent.launchedLocally === true &&
    source === "provider" &&
    code === "user-cancelled" &&
    (intent.phase === "opened" || intent.phase === "uncertain")
  );
}
/** Persistence is part of the preflight: its promise must resolve before the caller opens native billing. */
export async function reserveStoreIntent<T extends LocalStoreIntent>(
  intent: T,
  request: MobileRequest,
  persist: (value: T) => Promise<void>,
): Promise<T> {
  if (intent.launchedLocally || ["opened", "uncertain", "purchased"].includes(intent.phase))
    throw new Error(
      "A store payment may already exist for this reservation. Restore the original purchase instead of opening another payment sheet.",
    );
  await persist(intent);
  const reserved = await request<MobileStoreIntent>("/billing/store/intent", {
    method: "POST",
    body: {
      workspaceId: intent.workspaceId,
      provider: intent.provider,
      offerKey: intent.offerKey,
      operationId: intent.operationId,
    },
    idempotencyKey: intent.operationId,
  });
  if (
    typeof reserved.intentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reserved.intentId)
  )
    throw new Error(
      "The server did not confirm a valid purchase reservation. Resume the original purchase before opening the store.",
    );
  if (reserved.intentId !== intent.operationId) {
    await persist({
      ...intent,
      intentId: reserved.intentId,
      phase: "uncertain",
      launchedLocally: false,
    });
    throw new Error(
      "Another purchase attempt already holds this reservation. Restore the original or wait for its confirmed outcome; a second payment sheet was not opened.",
    );
  }
  const next = { ...intent, intentId: reserved.intentId, phase: "reserved" as const };
  await persist(next);
  return next;
}
