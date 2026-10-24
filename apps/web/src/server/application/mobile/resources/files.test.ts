// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { StorageApiError } from "@supabase/supabase-js";
import { branded } from "@/types/ids";
const b = vi.hoisted(() => ({
  status: "pending",
  signed: vi.fn(),
  info: vi.fn(),
  event: vi.fn(),
  audit: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/server/foundation/files/index", () => ({
  createSignedUploadUrl: b.signed,
  buildStoragePath: () => "workspaces/test/receipt.jpg",
  getFile: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  isModuleEnabled: async () => true,
}));
vi.mock("@/server/infrastructure/storage/index", () => ({
  getStorageAdminClient: () => ({ storage: { from: () => ({ info: b.info }) } }),
  storageBucket: () => "files",
}));
vi.mock("@/server/infrastructure/events/index", () => ({ publishEvent: b.event }));
vi.mock("@/server/foundation/audit/index", () => ({ writeAudit: b.audit }));
vi.mock("@/server/infrastructure/db/client", () => ({
  getDataClient: () => ({
    from: () => {
      let updating = false;
      const builder = {
        select: () => builder,
        eq: () => builder,
        update: (payload: { upload_status: string }) => {
          updating = true;
          b.update(payload);
          return builder;
        },
        then: (resolve: (result: { data: { id: string }[]; error: null }) => void) => {
          const changed = updating && b.status === "pending";
          if (changed) b.status = "complete";
          return Promise.resolve({ data: changed ? [{ id }] : [], error: null }).then(resolve);
        },
        maybeSingle: async () => ({
          data: {
            id,
            workspace_id: id,
            uploaded_by_user_id: id,
            file_name: "receipt.jpg",
            mime_type: "image/jpeg",
            size_bytes: 123,
            entity_type: null,
            entity_id: null,
            storage_path: "workspaces/test/receipt.jpg",
            upload_status: b.status,
          },
          error: null,
        }),
      };
      return builder;
    },
  }),
}));
import { writeFiles } from "@/server/application/mobile/resources/files";
const id = "11111111-1111-4111-8111-111111111111";
const ctx = {
  workspaceId: branded<"WorkspaceId">(id),
  user: { id: branded<"UserId">(id), email: "owner@example.com" },
  role: "owner" as const,
  operationId: id,
};
beforeEach(() => {
  vi.clearAllMocks();
  b.status = "pending";
  b.signed.mockResolvedValue("https://storage.example/fresh");
  b.info.mockResolvedValue({ data: null, error: new StorageApiError("Not found", 404, "404") });
});
it("renews an expired upload URL while retaining the original file", async () => {
  expect(await writeFiles(ctx, [id, "upload-url"], "POST", {})).toEqual({
    fileId: id,
    storagePath: "workspaces/test/receipt.jpg",
    uploadUrl: "https://storage.example/fresh",
    completed: false,
  });
});
it("reconciles a lost completion response without uploading bytes again", async () => {
  b.status = "complete";
  expect(await writeFiles(ctx, [id, "upload-url"], "POST", {})).toEqual({
    fileId: id,
    storagePath: "workspaces/test/receipt.jpg",
    uploadUrl: null,
    completed: true,
  });
  expect(b.signed).not.toHaveBeenCalled();
  expect(b.info).not.toHaveBeenCalled();
});
it("finalizes committed bytes after a lost PUT response before completion was called", async () => {
  b.info.mockResolvedValue({ data: { size: 123, contentType: "image/jpeg" }, error: null });
  expect(b.status).toBe("pending");
  expect(await writeFiles(ctx, [id, "upload-url"], "POST", {})).toEqual({
    fileId: id,
    storagePath: "workspaces/test/receipt.jpg",
    uploadUrl: null,
    completed: true,
  });
  expect(b.status).toBe("complete");
  expect(b.info).toHaveBeenCalledWith("workspaces/test/receipt.jpg");
  expect(b.signed).not.toHaveBeenCalled();
  expect(b.event).toHaveBeenCalledOnce();
  expect(b.audit).toHaveBeenCalledOnce();
  await writeFiles(ctx, [id, "complete"], "POST", {});
  expect(b.event).toHaveBeenCalledOnce();
  expect(b.audit).toHaveBeenCalledOnce();
});
it.each([
  { size: 124, contentType: "image/jpeg" },
  { size: 123, contentType: "image/png" },
])("refuses to overwrite stored bytes that mismatch metadata: %j", async (data) => {
  b.info.mockResolvedValue({ data, error: null });
  await expect(writeFiles(ctx, [id, "upload-url"], "POST", {})).rejects.toMatchObject({
    status: 409,
  });
  expect(b.status).toBe("pending");
  expect(b.signed).not.toHaveBeenCalled();
  expect(b.event).not.toHaveBeenCalled();
});
it.each([
  new StorageApiError("Unavailable", 503, "503"),
  new StorageApiError("Forbidden", 403, "403"),
  new StorageApiError("Bad request", 400, "400"),
])("fails closed for storage errors instead of treating them as missing: %j", async (error) => {
  b.info.mockResolvedValue({ data: null, error });
  await expect(writeFiles(ctx, [id, "upload-url"], "POST", {})).rejects.toBeDefined();
  expect(b.status).toBe("pending");
  expect(b.signed).not.toHaveBeenCalled();
  expect(b.update).not.toHaveBeenCalled();
});
it("reconciles replayed upload initiation through the same committed-byte guards", async () => {
  b.info.mockResolvedValue({ data: { size: 123, contentType: "image/jpeg" }, error: null });
  expect(
    await writeFiles(ctx, ["upload"], "POST", {
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 123,
    }),
  ).toMatchObject({ fileId: id, completed: true, uploadUrl: null });
  expect(b.signed).not.toHaveBeenCalled();
  expect(b.event).toHaveBeenCalledOnce();
});
