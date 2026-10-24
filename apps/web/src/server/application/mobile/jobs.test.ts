// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  rpc: vi.fn(),
  deleteUser: vi.fn(),
  workspaceLookup: vi.fn(),
  update: vi.fn(),
  fileWorkspaces: [] as string[],
}));
const owned = "11111111-1111-4111-8111-111111111111";
const shared = "22222222-2222-4222-8222-222222222222";
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    from: (table: string) => {
      if (table === "account_deletion_requests")
        return {
          select: () => ({
            eq: () => ({
              lte: () => ({
                limit: async () => ({
                  data: [{ user_id: "closed-user", closed_workspace_ids: [owned, shared] }],
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: mocks.update }),
        };
      if (table === "workspaces")
        return {
          select: () => ({ in: () => ({ eq: () => ({ not: mocks.workspaceLookup }) }) }),
        };
      if (table === "files")
        return {
          select: () => ({
            in: (_key: string, ids: string[]) => {
              mocks.fileWorkspaces = ids;
              return {
                order: () => ({
                  range: async () => ({
                    data: ids.map((id) => ({ storage_path: `${id}/receipt.jpg` })),
                    error: null,
                  }),
                }),
              };
            },
          }),
        };
      throw new Error(`Unexpected table ${table}`);
    },
    rpc: mocks.rpc,
    auth: { admin: { deleteUser: mocks.deleteUser } },
  }),
}));
vi.mock("@/server/infrastructure/storage", () => ({
  getStorageAdminClient: () => ({ storage: { from: () => ({ remove: mocks.remove }) } }),
}));
vi.mock("@/server/infrastructure/config/env", () => ({ env: { SUPABASE_STORAGE_BUCKET: "test" } }));
import { purgeClosedAccounts } from "@/server/application/mobile/jobs";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fileWorkspaces = [];
  mocks.workspaceLookup.mockResolvedValue({ data: [{ id: owned }], error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.update.mockResolvedValue({ error: null });
});
it("removes bytes only for currently closed workspaces still owned by the closing user", async () => {
  expect(await purgeClosedAccounts()).toEqual({ completed: 1 });
  expect(mocks.fileWorkspaces).toEqual([owned]);
  expect(mocks.remove).toHaveBeenCalledWith([`${owned}/receipt.jpg`]);
  expect(mocks.rpc).toHaveBeenCalledWith("mobile_purge_account", { p_user_id: "closed-user" });
});
it("keeps the deletion job pending without removing bytes if ownership cannot be revalidated", async () => {
  mocks.workspaceLookup.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await purgeClosedAccounts()).toEqual({ completed: 0 });
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  log.mockRestore();
});
