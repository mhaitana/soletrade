import { purgeClosedAccountLocally } from "@/application/account-cleanup";
import { purgeClosedAccountData } from "@/lib/offline/store";
import { supabase } from "@/lib/supabase";
const mockOrder: string[] = [];
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: jest.fn(async () => {
        mockOrder.push("local-auth");
      }),
    },
  },
}));
jest.mock("@/lib/native/shift", () => ({
  suspendShiftForLogout: jest.fn(async () => {
    mockOrder.push("suspend");
  }),
  discardPrivateDeviceData: jest.fn(async () => {
    mockOrder.push("private-route");
  }),
}));
jest.mock("@/lib/offline/store", () => ({
  purgeClosedAccountData: jest.fn(async () => {
    mockOrder.push("purge");
  }),
}));
jest.mock("@/lib/native/widgets", () => ({
  clearWidgets: jest.fn(async () => {
    mockOrder.push("widgets");
  }),
}));
jest.mock("@/lib/native/shortcuts", () => ({
  clearAppShortcuts: jest.fn(async () => {
    mockOrder.push("shortcuts");
  }),
}));
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn(async (key: string) => {
    mockOrder.push(key);
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockOrder.length = 0;
});
it("stops capture and purges private data, caches, widgets and preferences before clearing local authentication", async () => {
  await purgeClosedAccountLocally("u");
  expect(mockOrder).toEqual([
    "suspend",
    "purge",
    "private-route",
    "widgets",
    "shortcuts",
    "lock.u",
    "workspace.u",
    "local-auth",
  ]);
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
});
it("continues clearing other private surfaces and local authentication when one cleanup step fails", async () => {
  jest.mocked(purgeClosedAccountData).mockRejectedValueOnce(new Error("SQLite unavailable"));
  await expect(purgeClosedAccountLocally("u")).rejects.toThrow("SQLite unavailable");
  expect(mockOrder).toContain("widgets");
  expect(mockOrder.at(-1)).toBe("local-auth");
});
