import {
  createDraft,
  durableFile,
  listDrafts,
  logoutDisposition,
  purgeClosedAccountData,
  recoverCapturedFiles,
  retireCompletedCapture,
  writeState,
} from "@/lib/offline/store";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({
  root: "",
  drafts: new Map<string, { user_id: string; workspace_id: string; payload: string }>(),
  states: new Map<string, string>(),
  failDraft: false,
  copyWait: null as Promise<void> | null,
  copyEntered: null as (() => void) | null,
  events: [] as string[],
}));
vi.mock("expo-crypto", async () => ({ randomUUID: (await import("node:crypto")).randomUUID }));
vi.mock("expo/fetch", () => ({ fetch: vi.fn() }));
vi.mock("expo-file-system", async () => {
  const fs = await import("node:fs"),
    fsp = await import("node:fs/promises"),
    path = await import("node:path"),
    url = await import("node:url"),
    crypto = await import("node:crypto");
  const asPath = (parts: (string | { uri: string })[]) =>
    parts
      .map((part) => {
        const value = typeof part === "string" ? part : part.uri;
        return value.startsWith("file:") ? url.fileURLToPath(value) : value;
      })
      .reduce((base, part) => path.join(base, part));
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(asPath(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    get name() {
      return path.basename(url.fileURLToPath(this.uri));
    }
    create() {
      fs.mkdirSync(url.fileURLToPath(this.uri), { recursive: true });
    }
    delete() {
      fs.rmSync(url.fileURLToPath(this.uri), { recursive: true, force: true });
    }
    list() {
      return fs
        .readdirSync(url.fileURLToPath(this.uri), { withFileTypes: true })
        .map((entry) =>
          entry.isDirectory() ? new Directory(this, entry.name) : new File(this, entry.name),
        );
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = url.pathToFileURL(asPath(parts)).href;
    }
    get exists() {
      return fs.existsSync(url.fileURLToPath(this.uri));
    }
    get name() {
      return path.basename(url.fileURLToPath(this.uri));
    }
    get size() {
      return this.exists ? fs.statSync(url.fileURLToPath(this.uri)).size : 0;
    }
    get parentDirectory() {
      return new Directory(path.dirname(url.fileURLToPath(this.uri)));
    }
    async digest() {
      return crypto
        .createHash("sha256")
        .update(await fsp.readFile(url.fileURLToPath(this.uri)))
        .digest("hex");
    }
    async write(content: string) {
      await fsp.writeFile(url.fileURLToPath(this.uri), content);
      memory.events.push("journal-written");
    }
    textSync() {
      return fs.readFileSync(url.fileURLToPath(this.uri), "utf8");
    }
    async text() {
      return fsp.readFile(url.fileURLToPath(this.uri), "utf8");
    }
    async copy(destination: File) {
      memory.events.push("copy-start");
      memory.copyEntered?.();
      if (memory.copyWait) await memory.copyWait;
      await fsp.mkdir(path.dirname(url.fileURLToPath(destination.uri)), { recursive: true });
      await fsp.copyFile(url.fileURLToPath(this.uri), url.fileURLToPath(destination.uri));
    }
    async move(destination: File) {
      await fsp.rename(url.fileURLToPath(this.uri), url.fileURLToPath(destination.uri));
      this.uri = destination.uri;
    }
    delete() {
      fs.rmSync(url.fileURLToPath(this.uri), { force: true });
    }
  }
  return {
    Directory,
    File,
    Paths: {
      get document() {
        return url.pathToFileURL(memory.root).href;
      },
    },
  };
});
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getAllAsync: async (sql: string, ...args: string[]) =>
      sql.includes("FROM drafts")
        ? [...memory.drafts.values()].filter(
            (row) => row.user_id === args[0] && (!args[1] || row.workspace_id === args[1]),
          )
        : [...memory.states]
            .filter(([key]) => !args[0] || key.startsWith(args[0]))
            .map(([state_key, payload]) => ({ state_key, payload })),
    getFirstAsync: async (sql: string, id: string) =>
      sql.includes("FROM drafts")
        ? (memory.drafts.get(id) ?? null)
        : memory.states.has(id)
          ? { payload: memory.states.get(id) }
          : null,
    runAsync: async (sql: string, ...args: unknown[]) => {
      if (sql.startsWith("INSERT INTO drafts")) {
        if (memory.failDraft) {
          memory.failDraft = false;
          throw new Error("SQLite unavailable");
        }
        memory.drafts.set(String(args[0]), {
          user_id: String(args[1]),
          workspace_id: String(args[2]),
          payload: String(args[4]),
        });
      } else if (sql.startsWith("INSERT INTO native_state"))
        memory.states.set(String(args[0]), String(args[1]));
      else if (sql.startsWith("DELETE FROM drafts")) {
        for (const [id, row] of memory.drafts)
          if (row.user_id === args[0]) memory.drafts.delete(id);
      } else if (sql.startsWith("DELETE FROM native_state")) memory.states.delete(String(args[0]));
      return { changes: 1 };
    },
  }),
}));
const binding = { userId: "capture-user", workspaceId: "capture-workspace" };
beforeEach(async () => {
  memory.root = await mkdtemp(join(tmpdir(), "soletrade-capture-test-"));
  memory.drafts.clear();
  memory.states.clear();
  memory.failDraft = false;
  memory.copyWait = null;
  memory.copyEntered = null;
  memory.events = [];
  await writeFile(join(memory.root, "source.pdf"), "original receipt bytes");
});
afterEach(async () => {
  await rm(memory.root, { recursive: true, force: true });
});
const source = () => pathToFileURL(join(memory.root, "source.pdf")).href;
async function ageJournal(file: { journalUri?: string }) {
  const metadata = JSON.parse(
    await (await import("node:fs/promises")).readFile(fileURLToPath(file.journalUri!), "utf8"),
  );
  metadata.sessionId = "previous-process";
  await writeFile(fileURLToPath(file.journalUri!), JSON.stringify(metadata));
}
describe("bound durable capture recovery", () => {
  it("journals original metadata before awaited copy and recovers an unindexed complete original without financial fields or auto-queue", async () => {
    const file = await durableFile(
      binding,
      source(),
      "Original merchant receipt.pdf",
      "application/pdf",
    );
    expect(file.uri).toContain("/captures/capture-user/capture-workspace/");
    expect(memory.events.indexOf("journal-written")).toBeLessThan(
      memory.events.indexOf("copy-start"),
    );
    expect(await recoverCapturedFiles(binding)).toBe(0);
    await ageJournal(file);
    expect(await recoverCapturedFiles(binding)).toBe(1);
    const rows = await listDrafts(binding);
    expect(rows).toMatchObject([
      {
        status: "draft",
        kind: "receipt-recovered",
        body: {},
        files: [
          { name: "Original merchant receipt.pdf", mimeType: "application/pdf", uri: file.uri },
        ],
      },
    ]);
    expect(await recoverCapturedFiles(binding)).toBe(0);
    expect(await recoverCapturedFiles({ ...binding, workspaceId: "other" })).toBe(0);
  });
  it("recovers after SQLite indexing failure but skips originals already referenced by drafts or an upload", async () => {
    const file = await durableFile(binding, source(), "receipt.pdf", "application/pdf");
    memory.failDraft = true;
    await expect(
      createDraft({
        ...binding,
        kind: "receipt-expense",
        path: "/workspaces/capture-workspace/books/transactions",
        body: {},
        files: [file],
      }),
    ).rejects.toThrow("SQLite");
    await ageJournal(file);
    expect(await recoverCapturedFiles(binding)).toBe(1);
    const uploaded = await durableFile(binding, source(), "attached.pdf", "application/pdf");
    await ageJournal(uploaded);
    await writeState(`file-upload:${binding.userId}:${binding.workspaceId}`, {
      ...binding,
      file: uploaded,
    });
    expect(await recoverCapturedFiles(binding)).toBe(0);
  });
  it("purges a user folder including unindexed files while retaining another user originals", async () => {
    const owner = { userId: "purged-capture-owner", workspaceId: "one" },
      other = { userId: "other-capture-owner", workspaceId: "two" };
    const owned = await durableFile(owner, source(), "orphan.pdf", "application/pdf"),
      retained = await durableFile(other, source(), "other.pdf", "application/pdf");
    await purgeClosedAccountData(owner.userId);
    expect(await readdir(join(memory.root, "captures"))).not.toContain(owner.userId);
    expect((await import("node:fs")).existsSync(fileURLToPath(retained.uri))).toBe(true);
    expect((await import("node:fs")).existsSync(fileURLToPath(owned.uri))).toBe(false);
  });
  it("waits for an interrupted copy on closure and never recreates its bound folder afterward", async () => {
    const owner = { userId: "closing-copy-owner", workspaceId: "one" };
    let resume: () => void = () => {};
    memory.copyWait = new Promise((resolve) => {
      resume = resolve;
    });
    let entered = false;
    memory.copyEntered = () => {
      entered = true;
    };
    const copying = durableFile(owner, source(), "interrupted.pdf", "application/pdf");
    const rejected = expect(copying).rejects.toThrow();
    await vi.waitFor(() => expect(entered).toBe(true));
    const purging = purgeClosedAccountData(owner.userId);
    resume();
    await Promise.all([purging, rejected]);
    expect((await import("node:fs")).existsSync(join(memory.root, "captures", owner.userId))).toBe(
      false,
    );
  });
  it("discards unindexed captures and blocks late draft/upload indexing of their original capture IDs", async () => {
    const owner = { userId: "discarded-capture-owner", workspaceId: "one" };
    const file = await durableFile(owner, source(), "not-indexed.pdf", "application/pdf");
    await logoutDisposition(owner.userId, "discard");
    expect((await import("node:fs")).existsSync(fileURLToPath(file.uri))).toBe(false);
    await expect(
      createDraft({
        ...owner,
        kind: "receipt-expense",
        path: "/workspaces/one/books/transactions",
        body: {},
        files: [file],
      }),
    ).rejects.toThrow("discarded");
    await writeState(`file-upload:${owner.userId}:${owner.workspaceId}`, { ...owner, file });
    expect(memory.states.has(`file-upload:${owner.userId}:${owner.workspaceId}`)).toBe(false);
  });
});

it("never republishes a partial or mismatched copy and never rebinds a complete capture", async () => {
  const owner = { userId: "partial-capture-owner", workspaceId: "one" };
  const file = await durableFile(owner, source(), "partial.pdf", "application/pdf");
  await ageJournal(file);
  const fsp = await import("node:fs/promises");
  await fsp.rename(fileURLToPath(file.uri), fileURLToPath(`${file.uri}.copying`));
  await fsp.writeFile(fileURLToPath(`${file.uri}.copying`), Buffer.alloc(file.sizeBytes, 0));
  expect(await recoverCapturedFiles(owner)).toBe(0);
  expect(await listDrafts(owner)).toEqual([]);
  await purgeClosedAccountData(owner.userId);
  expect((await import("node:fs")).existsSync(join(memory.root, "captures", owner.userId))).toBe(
    false,
  );
  const bound = { userId: "bound-capture-owner", workspaceId: "one" };
  const intact = await durableFile(bound, source(), "receipt.pdf", "application/pdf");
  await expect(
    createDraft({
      ...bound,
      workspaceId: "two",
      kind: "receipt-expense",
      path: "/workspaces/two/books/transactions",
      body: {},
      files: [intact],
    }),
  ).rejects.toThrow("another account or workspace");
});

const uploadKey = (owner: typeof binding) => `file-upload:${owner.userId}:${owner.workspaceId}`;
it("retires a server-confirmed standalone upload before clearing state so restart never recovers a false receipt", async () => {
  const file = await durableFile(binding, source(), "Contract.pdf", "application/pdf");
  await ageJournal(file);
  await writeState(uploadKey(binding), {
    ...binding,
    file,
    fileId: "completed-file",
    completed: true,
  });
  await retireCompletedCapture(binding, file, { fileId: "completed-file", completed: true });
  await writeState(uploadKey(binding), null);
  await retireCompletedCapture(binding, file, { fileId: "completed-file", completed: true });
  expect((await import("node:fs")).existsSync(fileURLToPath(file.uri))).toBe(false);
  expect((await import("node:fs")).existsSync(fileURLToPath(file.journalUri!))).toBe(false);
  expect(await recoverCapturedFiles(binding)).toBe(0);
  expect(await listDrafts(binding)).toEqual([]);
});
it("retains the original after a lost completion response until the same bound file is confirmed complete", async () => {
  const file = await durableFile(binding, source(), "Contract.pdf", "application/pdf");
  await ageJournal(file);
  await writeState(uploadKey(binding), {
    ...binding,
    file,
    fileId: "pending-file",
    completed: false,
  });
  await expect(
    retireCompletedCapture(binding, file, { fileId: "pending-file", completed: true }),
  ).rejects.toThrow();
  const fs = await import("node:fs");
  expect(fs.existsSync(fileURLToPath(file.uri))).toBe(true);
  expect(fs.existsSync(fileURLToPath(file.journalUri!))).toBe(true);
  expect(await recoverCapturedFiles(binding)).toBe(0);
  await writeState(uploadKey(binding), {
    ...binding,
    file,
    fileId: "pending-file",
    completed: true,
  });
  await expect(
    retireCompletedCapture({ ...binding, workspaceId: "other" }, file, {
      fileId: "pending-file",
      completed: true,
    }),
  ).rejects.toThrow();
  await expect(
    retireCompletedCapture(binding, file, { fileId: "different-file", completed: true }),
  ).rejects.toThrow();
  expect(fs.existsSync(fileURLToPath(file.uri))).toBe(true);
  await retireCompletedCapture(binding, file, { fileId: "pending-file", completed: true });
  expect(fs.existsSync(fileURLToPath(file.uri))).toBe(false);
});
it("retires upload recovery metadata while preserving an original needed by an existing draft", async () => {
  const file = await durableFile(binding, source(), "receipt.pdf", "application/pdf");
  const draft = await createDraft({
    ...binding,
    kind: "receipt-expense",
    path: "/workspaces/capture-workspace/books/transactions",
    body: {},
    files: [file],
  });
  await writeState(uploadKey(binding), {
    ...binding,
    file,
    fileId: "shared-file",
    completed: true,
  });
  await retireCompletedCapture(binding, file, { fileId: "shared-file", completed: true });
  await writeState(uploadKey(binding), null);
  await retireCompletedCapture(binding, file, { fileId: "shared-file", completed: true });
  expect((await import("node:fs")).existsSync(fileURLToPath(file.uri))).toBe(true);
  expect((await import("node:fs")).existsSync(fileURLToPath(file.journalUri!))).toBe(false);
  expect((await listDrafts(binding))[0].id).toBe(draft.id);
  expect(await recoverCapturedFiles(binding)).toBe(0);
});
