import { ApiError } from "@/lib/api";
import { cacheReference, clearWorkspaceReferences, readReference } from "@/lib/offline/store";
import { useResource } from "@/lib/resources";
import { act, renderHook, waitFor } from "@testing-library/react-native";
const mockRequest = jest.fn();
const mockRefresh = jest.fn().mockResolvedValue(undefined);
let mockCache: unknown;
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "operation" }));
jest.mock("@/lib/session", () => ({
  useSession: () => ({
    userId: "u",
    workspaceId: "w",
    request: mockRequest,
    refreshBootstrap: mockRefresh,
  }),
}));
jest.mock("@/lib/offline/store", () => ({
  cacheReference: jest.fn(async (_binding, _key, value) => {
    mockCache = value;
  }),
  readReference: jest.fn(async () => (mockCache ? { data: mockCache, syncedAt: 1 } : null)),
  clearWorkspaceReferences: jest.fn(async () => {
    mockCache = undefined;
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCache = undefined;
});
it.each(["MODULE_UNAVAILABLE", "module_unavailable"])(
  "evicts previously cached records on 404 %s and never reloads them after remount",
  async (code) => {
    const data = { items: [{ id: "private", number: "INV-private" }] };
    mockRequest.mockResolvedValueOnce(data);
    const first = await renderHook(() => useResource("/workspaces/w/invoices"));
    await waitFor(() => expect(first.result.current.data).toEqual(data));
    await waitFor(() => expect(cacheReference).toHaveBeenCalled());
    mockRequest.mockRejectedValue(
      new ApiError({ code, message: "This module is unavailable." }, 404),
    );
    (readReference as jest.Mock).mockClear();
    await act(async () => {
      await first.result.current.refresh();
    });
    expect(first.result.current.data).toBeUndefined();
    expect(first.result.current.error).toBe("This module is unavailable.");
    expect(clearWorkspaceReferences).toHaveBeenCalledWith({ userId: "u", workspaceId: "w" });
    expect(mockRefresh).toHaveBeenCalled();
    expect(readReference).not.toHaveBeenCalled();
    await first.unmount();
    const next = await renderHook(() => useResource("/workspaces/w/invoices"));
    await waitFor(() => expect(next.result.current.error).toBe("This module is unavailable."));
    expect(next.result.current.data).toBeUndefined();
    expect(next.result.current.cached).not.toBe(true);
  },
);
it("never shows the saved copy once the first background refresh is authoritatively denied", async () => {
  mockCache = { items: [{ id: "private" }] };
  let reject!: (reason: unknown) => void;
  mockRequest.mockReturnValue(new Promise((_resolve, fail) => (reject = fail)));
  const hook = await renderHook(() => useResource<{ items: unknown[] }>("/workspaces/w/invoices"));
  await waitFor(() => expect(hook.result.current.cached).toBe(true));
  expect(hook.result.current.data).toEqual({ items: [{ id: "private" }] });
  expect(hook.result.current.refreshing).toBe(true);
  await act(async () => {
    reject(new ApiError({ code: "MODULE_UNAVAILABLE", message: "Unavailable." }, 404));
  });
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.denied).toBe(true);
  expect(clearWorkspaceReferences).toHaveBeenCalledWith({ userId: "u", workspaceId: "w" });
  expect(mockCache).toBeUndefined();
});
it("surfaces a non-authoritative 4xx instead of keeping the saved copy", async () => {
  mockCache = { items: [{ id: "old" }] };
  mockRequest.mockRejectedValue(new ApiError({ code: "NOT_FOUND", message: "Gone." }, 400));
  const hook = await renderHook(() => useResource("/workspaces/w/invoices/x"));
  await waitFor(() => expect(hook.result.current.error).toBe("Gone."));
  expect(hook.result.current.data).toBeUndefined();
  expect(hook.result.current.refreshing).toBe(false);
});
