import { act, renderHook, waitFor } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import { useResource } from "@/lib/resources";
import { cacheReference, clearWorkspaceReferences, readReference } from "@/offline/store";
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
jest.mock("@/offline/store", () => ({
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
    expect(readReference).not.toHaveBeenCalled();
  },
);
