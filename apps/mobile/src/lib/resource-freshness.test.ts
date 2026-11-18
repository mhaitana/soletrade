import { readReference } from "@/lib/offline/store";
import { useResource } from "@/lib/resources";
import { act, renderHook, waitFor } from "@testing-library/react-native";
const mockRequest = jest.fn();
const mockRefresh = jest.fn().mockResolvedValue(undefined);
let mockSaved: { data: unknown; syncedAt: number } | null;
let mockBinding = { userId: "user", workspaceId: "workspace" };
jest.mock("@/lib/session", () => ({
  useSession: () => ({ ...mockBinding, request: mockRequest, refreshBootstrap: mockRefresh }),
}));
jest.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  subscribeApiFailures: () => () => undefined,
}));
jest.mock("@/lib/offline/store", () => ({
  cacheReference: jest.fn(),
  clearWorkspaceReferences: jest.fn(),
  readReference: jest.fn(async () => mockSaved),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSaved = null;
  mockBinding = { userId: "user", workspaceId: "workspace" };
});
it("preserves the original cached sync time through offline refreshes instead of advertising current time", async () => {
  mockSaved = { data: { income: 123 }, syncedAt: 1000 };
  mockRequest.mockRejectedValue(new Error("offline"));
  const hook = await renderHook(() => useResource("/workspaces/workspace/dashboard"));
  await waitFor(() => expect(hook.result.current.cached).toBe(true));
  expect(hook.result.current.syncedAt).toBe(1000);
  mockSaved = { data: { income: 456 }, syncedAt: 2000 };
  await act(async () => {
    await hook.result.current.refresh();
  });
  expect(hook.result.current.syncedAt).toBe(1000);
  expect(hook.result.current.data).toEqual({ income: 123 });
});
it("sets freshness only after a successful bound network response", async () => {
  mockRequest.mockResolvedValue({ income: 789 });
  const start = Date.now();
  const hook = await renderHook(() => useResource("/workspaces/workspace/dashboard"));
  await waitFor(() => expect(hook.result.current.cached).toBe(false));
  expect(hook.result.current.syncedAt).toBeGreaterThanOrEqual(start);
  expect(hook.result.current.syncedAt).toBeLessThanOrEqual(Date.now());
});

it("shows the saved copy immediately, then replaces it with the network response without an error state", async () => {
  mockSaved = { data: { income: 123 }, syncedAt: 1000 };
  let resolve!: (value: unknown) => void;
  mockRequest.mockReturnValue(new Promise((done) => (resolve = done)));
  const hook = await renderHook(() => useResource("/workspaces/workspace/dashboard"));
  await waitFor(() => expect(hook.result.current.data).toEqual({ income: 123 }));
  expect(hook.result.current).toMatchObject({
    cached: true,
    syncedAt: 1000,
    refreshing: true,
    loading: false,
    error: undefined,
  });
  expect(readReference).toHaveBeenCalledWith(
    { userId: "user", workspaceId: "workspace" },
    "/workspaces/workspace/dashboard",
  );
  await act(async () => resolve({ income: 456 }));
  expect(hook.result.current).toMatchObject({
    data: { income: 456 },
    cached: false,
    refreshing: false,
  });
  expect(hook.result.current.error).toBeUndefined();
});
it("keeps the saved copy and reports an error only when the background refresh fails", async () => {
  mockSaved = { data: { income: 123 }, syncedAt: 1000 };
  mockRequest.mockRejectedValue(new Error("offline"));
  const hook = await renderHook(() => useResource("/workspaces/workspace/dashboard"));
  await waitFor(() => expect(hook.result.current.error).toBe("offline"));
  expect(hook.result.current).toMatchObject({
    data: { income: 123 },
    cached: true,
    refreshing: false,
    syncedAt: 1000,
  });
});
it("does not let a slow saved-copy read overwrite a network response", async () => {
  let release!: (value: { data: unknown; syncedAt: number }) => void;
  (readReference as jest.Mock).mockImplementationOnce(
    () => new Promise((done) => (release = done)),
  );
  mockRequest.mockResolvedValue({ income: 789 });
  const hook = await renderHook(() => useResource("/workspaces/workspace/dashboard"));
  await waitFor(() => expect(hook.result.current.cached).toBe(false));
  await act(async () => release({ data: { income: 1 }, syncedAt: 5 }));
  expect(hook.result.current.data).toEqual({ income: 789 });
  expect(hook.result.current.cached).toBe(false);
});
it("only reads the saved copy for the current user and workspace", async () => {
  (readReference as jest.Mock).mockImplementation(async (binding: { workspaceId: string }) =>
    binding.workspaceId === "other" ? { data: { income: 999 }, syncedAt: 9 } : null,
  );
  mockRequest.mockReturnValue(new Promise(() => undefined));
  const hook = await renderHook(() => useResource("/workspaces/workspace/dashboard"));
  await act(async () => undefined);
  expect(hook.result.current.data).toBeUndefined();
  expect(readReference).toHaveBeenCalledWith(
    { userId: "user", workspaceId: "workspace" },
    "/workspaces/workspace/dashboard",
  );
  expect(readReference).not.toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: "other" }),
    expect.anything(),
  );
});
