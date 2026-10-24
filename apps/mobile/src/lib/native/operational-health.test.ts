import { observeOperationalHealth } from "@/lib/native/operational-health";
import type { Binding, Draft } from "@/lib/offline/store";
import { listDrafts, readState, writeState } from "@/lib/offline/store";
import type { MobileRequest } from "@soletrade/contracts";

const mockState = new Map<string, any>();
let mockUUID = 0;
jest.mock("expo-crypto", () => ({
  randomUUID: () => `a107a043-d769-4c46-b999-${String(++mockUUID).padStart(12, "0")}`,
}));
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@/lib/offline/store", () => ({
  listDrafts: jest.fn(),
  readState: jest.fn(async (key: string) => mockState.get(key) ?? null),
  writeState: jest.fn(async (key: string, value: unknown) => {
    mockState.set(key, JSON.parse(JSON.stringify(value)));
  }),
}));
const binding: Binding = { userId: "private-account", workspaceId: "private-workspace" };
const draft = (overrides: Partial<Draft> = {}) =>
  ({
    ...binding,
    id: "private-draft",
    operationId: "private-operation",
    status: "blocked",
    attempts: 1,
    error: "private content, coordinates and error",
    files: [{ uri: "private-file" }],
    ...overrides,
  }) as Draft;
const key = `operational-health:${binding.userId}`;
beforeEach(() => {
  jest.clearAllMocks();
  mockState.clear();
  jest.mocked(listDrafts).mockResolvedValue([]);
});
it("transmits only strict health fields, never local identities, error text, content or routes", async () => {
  jest.mocked(listDrafts).mockResolvedValue([draft()]);
  mockState.set(`active-shift:${binding.userId}:${binding.workspaceId}`, "private-shift");
  mockState.set("shift:private-shift", {
    ...binding,
    id: "private-shift",
    recordingInterruptions: 2,
    permissionInterruptions: 1,
    points: [{ latitude: -37, longitude: 144 }],
    vehicleId: "private-vehicle",
    platform: "private-platform",
    error: "private error",
  });
  const request = jest.fn().mockResolvedValue({ accepted: true });
  await observeOperationalHealth(binding, request as MobileRequest);
  const [path, options] = request.mock.calls[0];
  expect(path).toBe("/me/health");
  expect(options.method).toBe("POST");
  expect(options.body.events).toHaveLength(3);
  for (const event of options.body.events) {
    expect(Object.keys(event).sort()).toEqual(["eventId", "kind", "platform", "reason"]);
    expect(event.platform).toBe("ios");
  }
  expect(JSON.stringify(options)).not.toMatch(
    /private|latitude|longitude|timestamp|workspace|error|vehicle/,
  );
  expect(mockState.get(key).events).toEqual([]);
});
it("retains durable UUIDs on failure and deduplicates repeated observations after success", async () => {
  jest.mocked(listDrafts).mockResolvedValue([draft({ status: "queued" })]);
  const request = jest
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ accepted: true });
  await observeOperationalHealth(binding, request as MobileRequest);
  const first = request.mock.calls[0][1].body;
  expect(mockState.get(key).events).toHaveLength(1);
  expect(first.events[0].reason).toBe("retryable");
  await observeOperationalHealth(binding, request as MobileRequest);
  expect(request.mock.calls[1][1].body).toEqual(first);
  await observeOperationalHealth(binding, request as MobileRequest);
  expect(request).toHaveBeenCalledTimes(2);
});
it("does not observe another account or workspace even if stale local rows are returned", async () => {
  jest.mocked(listDrafts).mockResolvedValue([draft({ workspaceId: "other" })]);
  mockState.set(`active-shift:${binding.userId}:${binding.workspaceId}`, "foreign");
  mockState.set("shift:foreign", {
    userId: "other",
    workspaceId: binding.workspaceId,
    id: "foreign",
    recordingInterruptions: 1,
  });
  mockState.set(key, { userId: "other", events: [{ private: "foreign" }], seen: [] });
  const request = jest.fn();
  await observeOperationalHealth(binding, request as MobileRequest);
  expect(request).not.toHaveBeenCalled();
});
it("bounds its durable queue and local seen signatures, and requires accepted:true to clear", async () => {
  mockState.set(key, {
    userId: binding.userId,
    events: [],
    seen: Array.from({ length: 150 }, (_, index) => `old-${index}`),
  });
  jest
    .mocked(listDrafts)
    .mockResolvedValue(Array.from({ length: 30 }, (_, index) => draft({ id: `draft-${index}` })));
  const request = jest.fn().mockResolvedValue({ accepted: false });
  await observeOperationalHealth(binding, request as MobileRequest);
  expect(mockState.get(key).events).toHaveLength(20);
  expect(mockState.get(key).seen).toHaveLength(100);
  expect(request.mock.calls[0][1].body.events).toHaveLength(20);
});
it("never propagates local storage or transport failures into capture or sync", async () => {
  const request = jest.fn();
  jest.mocked(readState).mockRejectedValueOnce(new Error("SQLite unavailable"));
  await expect(
    observeOperationalHealth(binding, request as MobileRequest),
  ).resolves.toBeUndefined();
  jest.mocked(listDrafts).mockResolvedValue([draft()]);
  jest.mocked(writeState).mockRejectedValueOnce(new Error("full"));
  await expect(
    observeOperationalHealth(binding, request as MobileRequest),
  ).resolves.toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});
it("rebuilds saved events through the allowlist before sending and never leaks extra cached fields", async () => {
  const eventId = "a107a043-d769-4c46-b999-0705d7734134";
  mockState.set(key, {
    userId: binding.userId,
    events: [
      {
        eventId,
        kind: "sync_failure",
        reason: "retryable",
        platform: "android",
        error: "private message",
        coordinates: [1, 2],
        workspaceId: "private-workspace",
      },
    ],
    seen: ["local-private-signature"],
  });
  const request = jest.fn().mockResolvedValue({ accepted: true });
  await observeOperationalHealth(binding, request as MobileRequest);
  expect(request.mock.calls[0][1].body).toEqual({
    events: [{ eventId, kind: "sync_failure", reason: "retryable", platform: "android" }],
  });
});
it("serializes simultaneous observations so pending events cannot acquire duplicate IDs or be lost", async () => {
  jest.mocked(listDrafts).mockResolvedValue([draft()]);
  let accept!: (value: { accepted: boolean }) => void;
  const request = jest.fn(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  const first = observeOperationalHealth(binding, request as MobileRequest);
  const second = observeOperationalHealth(binding, request as MobileRequest);
  // Flush the local observation work without resolving the network operation.
  for (let count = 0; count < 10 && !accept; count++) await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  accept({ accepted: true });
  await Promise.all([first, second]);
  expect(mockState.get(key).events).toEqual([]);
  expect(mockState.get(key).seen).toHaveLength(1);
});
