import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useResource } from "@/lib/resources";
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
jest.mock("@/offline/store", () => ({
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
