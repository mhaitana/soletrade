import { describe, expect, it, vi } from "vitest";
import {
  resumeStoreIntent,
  shouldCancelStoreIntent,
  reserveStoreIntent,
  uncertainStoreIntent,
  type LocalStoreIntent,
} from "./store-intent";
const operationId = "11111111-1111-4111-8111-111111111111",
  intentId = operationId;
const original: LocalStoreIntent = {
  userId: "user",
  workspaceId: "workspace",
  provider: "google",
  offerKey: "books.monthly",
  productId: "books",
  operationId,
  phase: "prepared",
};
describe("store purchase preflight", () => {
  it("reuses original operation and server intent after uncertain outcomes and refuses another target", () => {
    const uncertain = uncertainStoreIntent({
      ...original,
      intentId,
      phase: "opened",
      launchedLocally: true,
    });
    expect(
      resumeStoreIntent(uncertain, { ...original, operationId: "new-operation" }),
    ).toMatchObject({ operationId, intentId, phase: "uncertain" });
    expect(() => resumeStoreIntent(uncertain, { ...original, workspaceId: "other" })).toThrow(
      "original",
    );
    expect(() =>
      resumeStoreIntent(uncertain, { ...original, offerKey: "drive.monthly", productId: "drive" }),
    ).toThrow("Resume");
    expect(uncertainStoreIntent(original)).toMatchObject({ operationId, phase: "prepared" });
  });
  it("cancels a reservation only for exact provider-confirmed UserCancelled, never unknown, pending or a completed purchase", () => {
    const opened = { ...original, intentId, phase: "opened" as const, launchedLocally: true };
    expect(shouldCancelStoreIntent(opened, "provider", "user-cancelled")).toBe(true);
    for (const source of ["preflight", "unknown", "verification"] as const)
      expect(shouldCancelStoreIntent(opened, source, "user-cancelled")).toBe(false);
    for (const code of ["network-error", "deferred-payment", "unknown", "E_USER_CANCELLED"])
      expect(shouldCancelStoreIntent(opened, "provider", code)).toBe(false);
    expect(
      shouldCancelStoreIntent({ ...opened, phase: "purchased" }, "provider", "user-cancelled"),
    ).toBe(false);
    expect(
      shouldCancelStoreIntent({ ...opened, phase: "verified" }, "provider", "user-cancelled"),
    ).toBe(false);
  });
  it("durably saves stable operation before server preflight and saves returned reservation before store open", async () => {
    const order: string[] = [];
    const persist = vi.fn(async (value: LocalStoreIntent) => {
      order.push(value.intentId ? "persist-reserved" : "persist-prepared");
    });
    const request = vi.fn(async (path: string, options: unknown) => {
      order.push("server-preflight");
      expect(path).toBe("/billing/store/intent");
      expect(options).toMatchObject({
        idempotencyKey: operationId,
        body: {
          workspaceId: original.workspaceId,
          provider: "google",
          offerKey: original.offerKey,
          operationId,
        },
      });
      return { intentId };
    });
    const reserved = await reserveStoreIntent(original, request as never, persist);
    order.push("store-open");
    expect(order).toEqual([
      "persist-prepared",
      "server-preflight",
      "persist-reserved",
      "store-open",
    ]);
    expect(reserved).toMatchObject({ intentId, operationId, phase: "reserved" });
  });
  it("does not open the store after a lost preflight response or failed durable reservation save", async () => {
    const open = vi.fn(),
      persist = vi.fn(async () => {}),
      request = vi.fn().mockRejectedValue(new Error("Response lost"));
    await expect(reserveStoreIntent(original, request, persist).then(open)).rejects.toThrow(
      "Response lost",
    );
    expect(open).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith(original);
    const failSave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Disk full"));
    await expect(
      reserveStoreIntent(original, vi.fn().mockResolvedValue({ intentId }), failSave).then(open),
    ).rejects.toThrow("Disk full");
    expect(open).not.toHaveBeenCalled();
  });
});

it("does not launch a second device reservation or relaunch a locally uncertain payment", async () => {
  const persist = vi.fn(async () => {}),
    open = vi.fn();
  const other = "22222222-2222-4222-8222-222222222222";
  await expect(
    reserveStoreIntent(original, vi.fn().mockResolvedValue({ intentId: other }), persist).then(
      open,
    ),
  ).rejects.toThrow("Another purchase attempt");
  expect(open).not.toHaveBeenCalled();
  expect(persist).toHaveBeenLastCalledWith({
    ...original,
    intentId: other,
    phase: "uncertain",
    launchedLocally: false,
  });
  expect(
    shouldCancelStoreIntent(
      { ...original, intentId: other, phase: "uncertain", launchedLocally: false },
      "provider",
      "user-cancelled",
    ),
  ).toBe(false);
  const request = vi.fn();
  await expect(
    reserveStoreIntent(
      { ...original, intentId, phase: "uncertain", launchedLocally: true },
      request,
      persist,
    ),
  ).rejects.toThrow("Restore");
  expect(request).not.toHaveBeenCalled();
});
