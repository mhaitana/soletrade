import {
  correctRejectedDraft,
  createDraft,
  explicitSave,
  getDraft,
  listDrafts,
  logoutDisposition,
  purgeClosedAccountData,
  readState,
  syncOutbox,
  writeState,
} from "@/lib/offline/store";
import { fetch } from "expo/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({
  drafts: new Map<
    string,
    {
      id: string;
      user_id: string;
      workspace_id: string;
      status: string;
      payload: string;
      updated_at: number;
    }
  >(),
  counter: 0,
  states: new Map<string, string>(),
  deletedFiles: [] as string[],
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `operation-${++memory.counter}` }));
vi.mock("expo-file-system", () => ({
  Directory: class {},
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return !memory.deletedFiles.includes(this.uri);
    }
    delete() {
      memory.deletedFiles.push(this.uri);
    }
  },
  Paths: { document: "file:///documents" },
}));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getAllAsync: async (sql: string, userId: string, workspaceId?: string) =>
      sql.includes("FROM native_state")
        ? [...memory.states].map(([state_key, payload]) => ({ state_key, payload }))
        : [...memory.drafts.values()].filter(
            (row) => row.user_id === userId && (!workspaceId || row.workspace_id === workspaceId),
          ),
    getFirstAsync: async (sql: string, id: string) =>
      sql.includes("FROM native_state")
        ? memory.states.has(id)
          ? { payload: memory.states.get(id) }
          : null
        : (memory.drafts.get(id) ?? null),
    runAsync: async (sql: string, ...args: unknown[]) => {
      if (sql.startsWith("INSERT INTO native_state")) {
        memory.states.set(String(args[0]), String(args[1]));
        return { changes: 1 };
      }
      if (sql.startsWith("DELETE FROM native_state")) {
        memory.states.delete(String(args[0]));
        return { changes: 1 };
      }
      if (sql.startsWith("DELETE FROM drafts")) {
        for (const [id, row] of memory.drafts)
          if (row.user_id === args[0]) memory.drafts.delete(id);
        return { changes: 1 };
      }
      if (sql.startsWith("DELETE FROM reference_cache")) return { changes: 0 };
      if (sql.startsWith("INSERT INTO drafts")) {
        const [id, user_id, workspace_id, status, payload, updated_at] = args as [
          string,
          string,
          string,
          string,
          string,
          number,
        ];
        memory.drafts.set(id, { id, user_id, workspace_id, status, payload, updated_at });
        return { changes: 1 };
      }
      if (sql.startsWith("UPDATE drafts") && sql.includes("payload=?")) {
        const [
          status,
          payload,
          updated_at,
          id,
          userId,
          workspaceId,
          expectedStatus,
          expectedPayload,
        ] = args as [string, string, number, string, string, string, string, string];
        const row = memory.drafts.get(id);
        if (
          !row ||
          row.status !== expectedStatus ||
          row.payload !== expectedPayload ||
          row.user_id !== userId ||
          row.workspace_id !== workspaceId
        )
          return { changes: 0 };
        memory.drafts.set(id, { ...row, status, payload, updated_at });
        return { changes: 1 };
      }
      if (sql.startsWith("UPDATE drafts")) {
        const [status, updated_at, id, expected, updated] = args as [
          string,
          number,
          string,
          string,
          number,
        ];
        const row = memory.drafts.get(id);
        if (row?.status !== expected || row.updated_at !== updated) return { changes: 0 };
        memory.drafts.set(id, { ...row, status, updated_at });
        return { changes: 1 };
      }
      throw new Error(`Unexpected database command: ${sql}`);
    },
  }),
}));
const binding = { userId: "user-a", workspaceId: "workspace-a" };
beforeEach(() => {
  memory.drafts.clear();
  memory.counter = 0;
  memory.states.clear();
  memory.deletedFiles = [];
});
describe("outbox replay safety", () => {
  it("retains the same operation after a committed server result is lost and sends only once concurrently", async () => {
    const draft = await createDraft({
      ...binding,
      kind: "customer",
      path: "/workspaces/workspace-a/customers",
      body: { name: "Local customer" },
    });
    await explicitSave(binding, draft.id);
    await explicitSave(binding, draft.id);
    const accepted = new Set<string>();
    let loseResponse = true;
    const request = vi.fn(async (_path: string, options?: { idempotencyKey?: string }) => {
      accepted.add(options!.idempotencyKey!);
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Connection lost after commit");
      }
      return { id: "server-customer" };
    });
    const first = await syncOutbox(binding, request as never);
    expect(first.failed).toBe(1);
    expect((await listDrafts(binding))[0].status).toBe("queued");
    await explicitSave(binding, draft.id);
    await Promise.all([
      syncOutbox(binding, request as never),
      syncOutbox(binding, request as never),
    ]);
    expect(accepted.size).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect((await listDrafts(binding))[0]).toMatchObject({
      status: "synced",
      operationId: draft.operationId,
      resultId: "server-customer",
    });
  });
  it("never sends another workspace drafts or rebinds deterministic draft IDs", async () => {
    const draft = await createDraft({
      ...binding,
      id: "stable-shift",
      kind: "trip",
      path: "/workspaces/workspace-a/drive/trips",
      body: { distanceMeters: 1000 },
    });
    await explicitSave(binding, draft.id);
    const other = { userId: "user-b", workspaceId: "workspace-a" },
      request = vi.fn();
    await expect(explicitSave(other, draft.id)).rejects.toThrow("another account");
    await expect(
      createDraft({
        ...other,
        id: draft.id,
        kind: "trip",
        path: "/workspaces/workspace-a/drive/trips",
        body: {},
      }),
    ).rejects.toThrow("another account");
    await syncOutbox(other, request);
    expect(request).not.toHaveBeenCalled();
  });
  it("retains blocked work after module removal and retries only after explicit Save", async () => {
    const draft = await createDraft({
      ...binding,
      kind: "expense",
      path: "/workspaces/workspace-a/books/transactions",
      body: { amountCents: 100 },
    });
    await explicitSave(binding, draft.id);
    const request = vi
      .fn()
      .mockRejectedValueOnce({ code: "MODULE_DISABLED", message: "Books disabled" })
      .mockResolvedValue({ id: "expense" });
    await syncOutbox(binding, request);
    expect((await listDrafts(binding))[0]).toMatchObject({
      status: "blocked",
      error: "Books disabled",
    });
    await syncOutbox(binding, request);
    expect(request).toHaveBeenCalledTimes(1);
    await explicitSave(binding, draft.id);
    await syncOutbox(binding, request);
    expect((await listDrafts(binding))[0].status).toBe("synced");
  });
  it("rejects existing-record offline edits and offline attachment saves", async () => {
    await expect(
      createDraft({
        ...binding,
        kind: "edit",
        path: "/workspaces/workspace-a/books/transactions/existing",
        body: {},
      }),
    ).rejects.toThrow("Only new");
    const draft = await createDraft({
      ...binding,
      kind: "receipt-attachment",
      path: "/workspaces/workspace-a/books/transactions",
      body: {},
    });
    await expect(explicitSave(binding, draft.id)).rejects.toThrow("online save");
  });
});

describe("closed account purge", () => {
  it("clears work even during sync and prevents delayed callbacks from resurrecting it", async () => {
    const binding = { userId: "closed-account", workspaceId: "workspace-closed" };
    const draft = await createDraft({
      ...binding,
      kind: "customer",
      path: "/workspaces/workspace-closed/customers",
      body: { name: "Private customer" },
    });
    await explicitSave(binding, draft.id);
    await writeState(`operation:${binding.userId}:save`, "pending");
    let respond: (value: unknown) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const syncing = syncOutbox(binding, request as never);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await purgeClosedAccountData(binding.userId);
    respond({ id: "committed-before-close" });
    await syncing;
    expect(await listDrafts(binding)).toEqual([]);
    expect(await readState(`operation:${binding.userId}:save`)).toBeNull();
    await writeState(`operation:${binding.userId}:late`, "late");
    expect(await readState(`operation:${binding.userId}:late`)).toBeNull();
    await expect(
      createDraft({
        ...binding,
        kind: "customer",
        path: "/workspaces/workspace-closed/customers",
        body: {},
      }),
    ).rejects.toThrow("closed");
  });
});

describe("durable signed upload retry", () => {
  it("renews an expired URL for the same file and skips bytes after completed-response loss", async () => {
    const draft = await createDraft({
      ...binding,
      kind: "receipt-expense",
      path: "/workspaces/workspace-a/books/transactions",
      body: { amountCents: 100 },
      files: [
        { uri: "file:///original.jpg", name: "receipt.jpg", mimeType: "image/jpeg", sizeBytes: 20 },
      ],
    });
    await explicitSave(binding, draft.id);
    vi.mocked(fetch).mockResolvedValue({ ok: true } as never);
    let completionLost = true;
    const request = vi.fn(async (path: string) => {
      if (path.endsWith("/files/upload"))
        return { fileId: "same-file", uploadUrl: "https://signed.test/original" };
      if (path.endsWith("/complete")) {
        if (completionLost) {
          completionLost = false;
          throw new Error("Lost completion response");
        }
        return { id: "same-file" };
      }
      if (path.endsWith("/upload-url"))
        return { fileId: "same-file", completed: true, uploadUrl: null };
      return { id: "expense" };
    });
    await syncOutbox(binding, request as never);
    await explicitSave(binding, draft.id);
    await syncOutbox(binding, request as never);
    expect(request.mock.calls.filter(([path]) => path.endsWith("/files/upload"))).toHaveLength(1);
    expect(request.mock.calls.filter(([path]) => path.endsWith("/upload-url"))).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await listDrafts(binding))[0]).toMatchObject({ status: "synced", resultId: "expense" });
  });
});

describe("definitively rejected draft correction", () => {
  it("reuses the capture and binding but creates a new operation only after structured validation rejection", async () => {
    const files = [
      {
        uri: "file:///original.jpg",
        name: "receipt.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 20,
        fileId: "uploaded-file",
        completed: true,
        uploadOperationId: "upload-op",
        completionOperationId: "complete-op",
      },
    ];
    const draft = await createDraft({
      ...binding,
      kind: "drive/expenses",
      path: "/workspaces/workspace-a/drive/expenses",
      body: { type: "parking", amountCents: 100 },
      files,
    });
    await explicitSave(binding, draft.id);
    await syncOutbox(
      binding,
      vi.fn().mockRejectedValue({
        status: 400,
        detail: { code: "invalid_request", message: "Unsupported expense type" },
      }),
    );
    expect(await getDraft(binding, draft.id)).toMatchObject({
      status: "blocked",
      validationRejected: true,
      uncertainOutcome: false,
    });
    const corrected = await correctRejectedDraft(binding, draft.id, {
      type: "other",
      amountCents: 100,
    });
    expect(corrected).toMatchObject({
      ...binding,
      id: draft.id,
      path: draft.path,
      kind: draft.kind,
      files,
      body: { type: "other", amountCents: 100 },
      status: "draft",
      attempts: 0,
      validationRejected: false,
      uncertainOutcome: false,
    });
    expect(corrected.operationId).not.toBe(draft.operationId);
    await expect(
      correctRejectedDraft({ ...binding, userId: "another" }, draft.id, {}),
    ).rejects.toThrow("another account");
  });
  it("refuses correction after uncertain delivery even if a later retry returns validation", async () => {
    const draft = await createDraft({
      ...binding,
      kind: "books/transactions",
      path: "/workspaces/workspace-a/books/transactions",
      body: { amountCents: 100 },
    });
    await explicitSave(binding, draft.id);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Lost response after commit"))
      .mockRejectedValue({
        status: 422,
        detail: { code: "VALIDATION_ERROR", message: "Invalid amount" },
      });
    await syncOutbox(binding, request);
    await explicitSave(binding, draft.id);
    await syncOutbox(binding, request);
    expect(await getDraft(binding, draft.id)).toMatchObject({
      validationRejected: false,
      uncertainOutcome: true,
    });
    await expect(correctRejectedDraft(binding, draft.id, { amountCents: 200 })).rejects.toThrow(
      "cannot be corrected",
    );
  });
  it("refuses pending, malformed, sending and synced operations", async () => {
    for (const error of [
      { status: 409, detail: { code: "OPERATION_PENDING", message: "Still processing" } },
      { status: 500, detail: { code: "INTERNAL_ERROR", message: "Unknown result" } },
      { status: 422, message: "No structured validation code" },
    ]) {
      const draft = await createDraft({
        ...binding,
        kind: "invoices",
        path: "/workspaces/workspace-a/invoices",
        body: {},
      });
      await explicitSave(binding, draft.id);
      await syncOutbox(binding, vi.fn().mockRejectedValue(error));
      await expect(correctRejectedDraft(binding, draft.id, {})).rejects.toThrow(
        "cannot be corrected",
      );
    }
    const draft = await createDraft({
      ...binding,
      kind: "quotes",
      path: "/workspaces/workspace-a/quotes",
      body: {},
    });
    await explicitSave(binding, draft.id);
    let respond: (value: unknown) => void = () => {};
    const request = vi.fn(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        }),
    );
    const job = syncOutbox(binding, request as never);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await expect(correctRejectedDraft(binding, draft.id, {})).rejects.toThrow(
      "cannot be corrected",
    );
    respond({ id: "saved" });
    await job;
    await expect(correctRejectedDraft(binding, draft.id, {})).rejects.toThrow(
      "cannot be corrected",
    );
  });
});

describe("independent durable upload disposition", () => {
  it("deletes captured upload files on account closure and discard, preventing stale callbacks from restoring discarded captures", async () => {
    const closing = "closing-upload-account",
      closingKey = `file-upload:${closing}:workspace`;
    await writeState(closingKey, {
      userId: closing,
      workspaceId: "workspace",
      file: { uri: "file:///closed-upload.jpg" },
      uploadOperationId: "closed-upload-op",
    });
    await purgeClosedAccountData(closing);
    expect(memory.deletedFiles).toContain("file:///closed-upload.jpg");
    expect(await readState(closingKey)).toBeNull();
    const key = `file-upload:${binding.userId}:${binding.workspaceId}`,
      original = {
        ...binding,
        file: { uri: "file:///discarded-upload.jpg" },
        uploadOperationId: "discarded-upload-op",
      };
    await writeState(key, original);
    await logoutDisposition(binding.userId, "discard");
    expect(memory.deletedFiles).toContain("file:///discarded-upload.jpg");
    expect(await readState(key)).toBeNull();
    await writeState(key, { ...original, fileId: "late-result" });
    expect(await readState(key)).toBeNull();
    await writeState(key, {
      ...original,
      uploadOperationId: "fresh-upload-op",
      file: { uri: "file:///fresh-upload.jpg" },
    });
    expect(await readState(key)).toMatchObject({ uploadOperationId: "fresh-upload-op" });
  });
});
