import { assertBinding, nextRetry, type Binding, type QueueEntry } from "@/lib/offline/policy";
import type { MobileRequest } from "@soletrade/contracts";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { fetch } from "expo/fetch";
export type { Binding } from "@/lib/offline/policy";
export interface DraftFile {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  fileId?: string;
  completed?: boolean;
  uploadOperationId?: string;
  completionOperationId?: string;
  captureId?: string;
  userId?: string;
  workspaceId?: string;
  journalUri?: string;
}
export interface Draft extends QueueEntry {
  kind: string;
  path: string;
  body: Record<string, unknown>;
  files: DraftFile[];
  createdAt: number;
  updatedAt: number;
  error?: string;
  nextAttemptAt: number;
  resultId?: string;
  validationRejected?: boolean;
  uncertainOutcome?: boolean;
}
const purgedUsers = new Set<string>();
const purgedStateIds = new Set<string>();
const discardedUploadOperations = new Set<string>();
const discardedCaptures = new Set<string>(),
  discardingUsers = new Set<string>();
const captureJobs = new Map<string, { userId: string; promise: Promise<DraftFile> }>();
const captureRecoveryJobs = new Map<string, Promise<number>>();
let captureSession: string | undefined;
const captureSessionId = () => (captureSession ??= Crypto.randomUUID());
let database: Promise<SQLite.SQLiteDatabase> | undefined;
export function localDatabase() {
  return (database ??= (async () => {
    const db = await SQLite.openDatabaseAsync("soletrade-mobile.db");
    await db.execAsync(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS draft_binding ON drafts(user_id,workspace_id,status);
      CREATE TABLE IF NOT EXISTS reference_cache (user_id TEXT NOT NULL,workspace_id TEXT NOT NULL,cache_key TEXT NOT NULL,payload TEXT NOT NULL,synced_at INTEGER NOT NULL,PRIMARY KEY(user_id,workspace_id,cache_key));
      CREATE TABLE IF NOT EXISTS native_state (state_key TEXT PRIMARY KEY,payload TEXT NOT NULL);`);
    return db;
  })());
}
export async function readState<T>(key: string): Promise<T | null> {
  const row = await (
    await localDatabase()
  ).getFirstAsync<{ payload: string }>("SELECT payload FROM native_state WHERE state_key=?", key);
  return row ? (JSON.parse(row.payload) as T) : null;
}
export async function writeState(key: string, value: unknown) {
  if (typeof value === "object" && value !== null && "file" in value) {
    const file = value.file as DraftFile | undefined;
    if (
      file?.captureId &&
      (discardedCaptures.has(file.captureId) || (file.userId && purgedUsers.has(file.userId)))
    )
      return;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "uploadOperationId" in value &&
    discardedUploadOperations.has(String(value.uploadOperationId))
  )
    return;
  if (
    key.split(":").some((part) => purgedUsers.has(part) || purgedStateIds.has(part)) ||
    (typeof value === "string" && purgedStateIds.has(value)) ||
    (typeof value === "object" &&
      value !== null &&
      "userId" in value &&
      purgedUsers.has(String(value.userId)))
  )
    return;
  await (
    await localDatabase()
  ).runAsync(
    "INSERT INTO native_state(state_key,payload) VALUES (?,?) ON CONFLICT(state_key) DO UPDATE SET payload=excluded.payload",
    key,
    JSON.stringify(value),
  );
}
export async function deleteState(key: string) {
  await (await localDatabase()).runAsync("DELETE FROM native_state WHERE state_key=?", key);
}
async function persist(draft: Draft) {
  if (purgedUsers.has(draft.userId)) return;
  await (
    await localDatabase()
  ).runAsync(
    "INSERT INTO drafts(id,user_id,workspace_id,status,payload,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at",
    draft.id,
    draft.userId,
    draft.workspaceId,
    draft.status,
    JSON.stringify(draft),
    draft.updatedAt,
  );
}
const captureSegment = (value: string) => {
  if (!value) throw new Error("Capture requires its original account and workspace.");
  return encodeURIComponent(value).replaceAll(".", "%2E");
};
function userCaptureDirectory(userId: string) {
  return new Directory(Paths.document, "captures", captureSegment(userId));
}
function workspaceCaptureDirectory(binding: Binding) {
  return new Directory(userCaptureDirectory(binding.userId), captureSegment(binding.workspaceId));
}
function assertCaptureActive(binding: Binding, captureId: string) {
  if (purgedUsers.has(binding.userId))
    throw new Error("This account is closed. Capture was removed.");
  if (discardingUsers.has(binding.userId) || discardedCaptures.has(captureId))
    throw new Error("This capture was discarded before it could be saved.");
}
function deleteCaptureFile(file: DraftFile) {
  if (file.captureId) discardedCaptures.add(file.captureId);
  for (const uri of [file.uri, file.journalUri]) {
    if (!uri) continue;
    const item = new File(uri);
    if (item.exists) item.delete();
  }
}
interface CaptureJournal extends Binding {
  version: 1;
  captureId: string;
  sessionId: string;
  createdAt: number;
  destinationName: string;
  sha256: string;
  file: DraftFile;
}
export function durableFile(
  binding: Binding,
  uri: string,
  name: string,
  mimeType: string,
): Promise<DraftFile> {
  const original = { userId: binding.userId, workspaceId: binding.workspaceId },
    captureId = Crypto.randomUUID();
  assertCaptureActive(original, captureId);
  const promise = copyBoundCapture(original, captureId, uri, name, mimeType).finally(() =>
    captureJobs.delete(captureId),
  );
  captureJobs.set(captureId, { userId: original.userId, promise });
  return promise;
}
async function copyBoundCapture(
  binding: Binding,
  captureId: string,
  uri: string,
  name: string,
  mimeType: string,
): Promise<DraftFile> {
  const directory = workspaceCaptureDirectory(binding),
    extension =
      name
        .split(".")
        .pop()
        ?.replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 16) || "bin";
  const destinationName = `${captureId}.${extension}`,
    destination = new File(directory, destinationName),
    temporary = new File(directory, `${destinationName}.copying`),
    journal = new File(directory, `${captureId}.capture.json`);
  try {
    const source = new File(uri);
    if (!source.exists || source.size <= 0)
      throw new Error("The selected original cannot be read. Choose it again.");
    const sizeBytes = source.size,
      sha256 = await source.digest("SHA-256");
    assertCaptureActive(binding, captureId);
    directory.create({ idempotent: true, intermediates: true });
    const file: DraftFile = {
      ...binding,
      captureId,
      uri: destination.uri,
      journalUri: journal.uri,
      name,
      mimeType,
      sizeBytes,
      uploadOperationId: Crypto.randomUUID(),
      completionOperationId: Crypto.randomUUID(),
    };
    const metadata: CaptureJournal = {
      ...binding,
      version: 1,
      captureId,
      sessionId: captureSessionId(),
      createdAt: Date.now(),
      destinationName,
      sha256,
      file,
    };
    await journal.write(JSON.stringify(metadata));
    assertCaptureActive(binding, captureId);
    await source.copy(temporary);
    assertCaptureActive(binding, captureId);
    if (temporary.size !== sizeBytes || (await temporary.digest("SHA-256")) !== sha256)
      throw new Error("The original copy was incomplete. Choose the file again.");
    assertCaptureActive(binding, captureId);
    await temporary.move(destination);
    assertCaptureActive(binding, captureId);
    return file;
  } catch (error) {
    for (const file of [temporary, destination, journal]) if (file.exists) file.delete();
    throw error;
  }
}
/** Retire recovery metadata only after the caller durably records server-confirmed completion. */
export async function retireCompletedCapture(
  binding: Binding,
  file: DraftFile,
  proof: { fileId: string; completed: true },
): Promise<void> {
  if (file.userId && file.workspaceId) assertBinding(file as Binding, binding);
  const directory = workspaceCaptureDirectory(binding);
  if (file.captureId) {
    if (
      file.userId !== binding.userId ||
      file.workspaceId !== binding.workspaceId ||
      !/^[a-zA-Z0-9-]+$/.test(file.captureId) ||
      file.journalUri !== new File(directory, `${file.captureId}.capture.json`).uri ||
      !new RegExp(`^${file.captureId}\\.[a-zA-Z0-9]{1,16}$`).test(new File(file.uri).name) ||
      new File(directory, new File(file.uri).name).uri !== file.uri
    )
      throw new Error("Capture does not belong to its original account and workspace.");
  } else {
    // Older indexed uploads had flat captures; never delete an arbitrary supplied URI.
    const legacy = new Directory(Paths.document, "captures");
    if (file.journalUri || new File(legacy, new File(file.uri).name).uri !== file.uri)
      throw new Error("The original upload location could not be verified.");
  }
  const saved = await readState<
    Binding & { file: DraftFile; fileId?: string; completed?: boolean }
  >(`file-upload:${binding.userId}:${binding.workspaceId}`);
  // A repeated cleanup after state clearing must not remove a draft-dependent original.
  if (!saved && (!file.journalUri || !new File(file.journalUri).exists)) return;
  if (
    proof.completed !== true ||
    !proof.fileId ||
    saved?.userId !== binding.userId ||
    saved.workspaceId !== binding.workspaceId ||
    saved.completed !== true ||
    saved.fileId !== proof.fileId ||
    saved.file?.uri !== file.uri ||
    saved.file.captureId !== file.captureId
  )
    throw new Error("Upload completion has not been confirmed for this original. It is retained.");
  // Stop a recovery already reading this journal before inspecting dependent drafts.
  if (file.captureId) discardedCaptures.add(file.captureId);
  const recovering = captureRecoveryJobs.get(`${binding.userId}:${binding.workspaceId}`);
  if (recovering) await recovering;
  const dependedOn = (await listDrafts(binding)).some((draft) =>
    draft.files.some((source) => source.uri === file.uri),
  );
  // Journal first: process death between these deletes cannot turn a completed PDF into a receipt.
  if (file.journalUri) {
    const journal = new File(file.journalUri);
    if (journal.exists) journal.delete();
  }
  if (!dependedOn) {
    const original = new File(file.uri);
    if (original.exists) original.delete();
  }
}
/** Directory ownership also covers copies whose SQLite indexing never completed. */
async function removeUserCaptureDirectory(userId: string) {
  for (const [id, job] of captureJobs) if (job.userId === userId) discardedCaptures.add(id);
  const directory = userCaptureDirectory(userId);
  const mark = (folder: Directory) => {
    for (const child of folder.list()) {
      if (child instanceof Directory) mark(child);
      else {
        const id = child.name.split(".")[0];
        if (/^[a-zA-Z0-9-]+$/.test(id)) discardedCaptures.add(id);
      }
    }
  };
  if (directory.exists) {
    mark(directory);
    directory.delete();
  }
  const pending: Promise<unknown>[] = [...captureJobs.values()]
    .filter((job) => job.userId === userId)
    .map((job) => job.promise);
  for (const [key, promise] of captureRecoveryJobs)
    if (key.startsWith(`${userId}:`)) pending.push(promise);
  await Promise.allSettled(pending);
  if (directory.exists) directory.delete();
}
export function recoverCapturedFiles(binding: Binding): Promise<number> {
  if (purgedUsers.has(binding.userId) || discardingUsers.has(binding.userId))
    return Promise.resolve(0);
  const key = `${binding.userId}:${binding.workspaceId}`,
    current = captureRecoveryJobs.get(key);
  if (current) return current;
  const promise = recoverBoundCaptures(binding).finally(() => captureRecoveryJobs.delete(key));
  captureRecoveryJobs.set(key, promise);
  return promise;
}
async function recoverBoundCaptures(binding: Binding) {
  const directory = workspaceCaptureDirectory(binding);
  if (!directory.exists) return 0;
  const referenced = new Set(
    (await listDrafts(binding)).flatMap((draft) => draft.files.map((file) => file.uri)),
  );
  const upload = await readState<Binding & { file?: DraftFile }>(
    `file-upload:${binding.userId}:${binding.workspaceId}`,
  );
  if (
    upload?.userId === binding.userId &&
    upload.workspaceId === binding.workspaceId &&
    upload.file
  )
    referenced.add(upload.file.uri);
  let recovered = 0;
  for (const entry of directory.list()) {
    if (!(entry instanceof File) || !entry.name.endsWith(".capture.json")) continue;
    try {
      const metadata = JSON.parse(await entry.text()) as CaptureJournal;
      if (
        metadata.version !== 1 ||
        typeof metadata.captureId !== "string" ||
        typeof metadata.destinationName !== "string" ||
        metadata.userId !== binding.userId ||
        metadata.workspaceId !== binding.workspaceId ||
        !metadata.file ||
        typeof metadata.file.name !== "string" ||
        !metadata.file.name ||
        typeof metadata.file.mimeType !== "string" ||
        !metadata.file.mimeType ||
        !/^[a-zA-Z0-9-]+$/.test(metadata.captureId) ||
        entry.name !== `${metadata.captureId}.capture.json` ||
        !/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]{1,16}$/.test(metadata.destinationName) ||
        metadata.file.uri !== new File(directory, metadata.destinationName).uri ||
        metadata.file.captureId !== metadata.captureId ||
        metadata.file.userId !== binding.userId ||
        metadata.file.workspaceId !== binding.workspaceId ||
        metadata.file.journalUri !== entry.uri ||
        !Number.isSafeInteger(metadata.file.sizeBytes) ||
        metadata.file.sizeBytes <= 0 ||
        !/^[a-f0-9]{64}$/i.test(metadata.sha256)
      )
        continue;
      assertCaptureActive(binding, metadata.captureId);
      if (captureJobs.has(metadata.captureId) || referenced.has(metadata.file.uri)) continue;
      if (metadata.sessionId === captureSessionId() && Date.now() - metadata.createdAt < 30000)
        continue;
      const destination = new File(metadata.file.uri),
        temporary = new File(directory, `${metadata.destinationName}.copying`),
        candidate = destination.exists ? destination : temporary;
      if (
        !candidate.exists ||
        candidate.size !== metadata.file.sizeBytes ||
        (await candidate.digest("SHA-256")) !== metadata.sha256
      )
        continue;
      assertCaptureActive(binding, metadata.captureId);
      if (!destination.exists) {
        await temporary.move(destination);
        assertCaptureActive(binding, metadata.captureId);
      }
      await createDraft({
        ...binding,
        id: metadata.captureId,
        operationId: metadata.captureId,
        kind: "receipt-recovered",
        path: `/workspaces/${binding.workspaceId}/books/transactions`,
        body: {},
        files: [metadata.file],
      });
      referenced.add(metadata.file.uri);
      recovered++;
    } catch {
      if (purgedUsers.has(binding.userId) || discardingUsers.has(binding.userId))
        return recovered; /* Unverifiable copies remain private for explicit disposition; never publish guessed fields. */
    }
  }
  return recovered;
}

export async function createDraft(
  input: Binding & {
    kind: string;
    path: string;
    body: Record<string, unknown>;
    files?: DraftFile[];
    id?: string;
    operationId?: string;
  },
): Promise<Draft> {
  if (purgedUsers.has(input.userId))
    throw new Error("This account is closed. Local writes are disabled.");
  for (const file of input.files ?? []) {
    if (file.userId && file.workspaceId) assertBinding(file as Binding, input);
    if (file.captureId) assertCaptureActive(input, file.captureId);
  }
  if (
    !/^\/workspaces\/[^/]+\/(customers|invoices|quotes|books\/transactions|drive\/(trips|earnings|expenses))$/.test(
      input.path,
    ) ||
    !input.path.startsWith(`/workspaces/${input.workspaceId}/`)
  )
    throw new Error("Only new records in the original workspace can be saved offline.");
  if (input.id) {
    const row = await (
      await localDatabase()
    ).getFirstAsync<{ payload: string }>("SELECT payload FROM drafts WHERE id=?", input.id);
    if (row) {
      const existing = JSON.parse(row.payload) as Draft;
      assertBinding(existing, input);
      return existing;
    }
  }
  const draft: Draft = {
    ...input,
    id: input.id ?? Crypto.randomUUID(),
    operationId: input.operationId ?? Crypto.randomUUID(),
    files: input.files ?? [],
    status: "draft",
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextAttemptAt: 0,
    validationRejected: false,
    uncertainOutcome: false,
  };
  await persist(draft);
  return draft;
}
export async function listDrafts(binding: Binding): Promise<Draft[]> {
  const rows = await (
    await localDatabase()
  ).getAllAsync<{ payload: string }>(
    "SELECT payload FROM drafts WHERE user_id=? AND workspace_id=? ORDER BY updated_at DESC",
    binding.userId,
    binding.workspaceId,
  );
  return rows.map((r) => JSON.parse(r.payload) as Draft);
}
export async function getDraft(binding: Binding, id: string) {
  const row = await (
    await localDatabase()
  ).getFirstAsync<{ payload: string }>("SELECT payload FROM drafts WHERE id=?", id);
  if (!row) throw new Error("Draft not found.");
  const draft = JSON.parse(row.payload) as Draft;
  assertBinding(draft, binding);
  return draft;
}
export async function updateDraft(binding: Binding, id: string, body: Record<string, unknown>) {
  const draft = await getDraft(binding, id);
  if (draft.status !== "draft")
    throw new Error("Queued work is immutable. Retry or discard this operation.");
  await persist({ ...draft, body, updatedAt: Date.now() });
}
/** A new operation is safe only after a known pre-effect validation rejection with no uncertain attempt. */
export async function correctRejectedDraft(
  binding: Binding,
  id: string,
  body: Record<string, unknown>,
): Promise<Draft> {
  if (purgedUsers.has(binding.userId))
    throw new Error("This account is closed. Local writes are disabled.");
  const draft = await getDraft(binding, id);
  if (
    draft.status !== "blocked" ||
    draft.validationRejected !== true ||
    draft.uncertainOutcome !== false ||
    draft.resultId
  )
    throw new Error(
      "This operation cannot be corrected safely. Retry its original operation or check its server status.",
    );
  const corrected: Draft = {
    ...draft,
    body,
    operationId: Crypto.randomUUID(),
    status: "draft",
    attempts: 0,
    error: undefined,
    nextAttemptAt: 0,
    validationRejected: false,
    uncertainOutcome: false,
    updatedAt: Date.now(),
  };
  const result = await (
    await localDatabase()
  ).runAsync(
    "UPDATE drafts SET status=?,payload=?,updated_at=? WHERE id=? AND user_id=? AND workspace_id=? AND status=? AND payload=?",
    corrected.status,
    JSON.stringify(corrected),
    corrected.updatedAt,
    id,
    binding.userId,
    binding.workspaceId,
    "blocked",
    JSON.stringify(draft),
  );
  if (!result.changes)
    throw new Error("This draft changed while opening correction. Refresh Drafts before saving.");
  return corrected;
}
export async function explicitSave(binding: Binding, id: string) {
  const draft = await getDraft(binding, id);
  if (draft.kind === "receipt-attachment")
    throw new Error("Attaching to an existing record requires an online save.");
  if (draft.status === "synced" || draft.status === "sending") return;
  await persist({
    ...draft,
    status: "queued",
    error: undefined,
    nextAttemptAt: 0,
    updatedAt: Date.now(),
  });
}
export async function discardDraft(binding: Binding, id: string) {
  const draft = await getDraft(binding, id);
  if (draft.status === "sending") throw new Error("Wait for the current upload to finish.");
  await (
    await localDatabase()
  ).runAsync(
    "DELETE FROM drafts WHERE id=? AND user_id=? AND workspace_id=?",
    id,
    binding.userId,
    binding.workspaceId,
  );
  purgedStateIds.add(draft.id);
  await deleteState(`ocr:${draft.id}`);
  await deleteState(`attachment-target:${draft.id}`);
  for (const item of draft.files) deleteCaptureFile(item);
}
const activeSyncs = new Map<string, Promise<{ sent: number; failed: number }>>();
export function syncOutbox(binding: Binding, request: MobileRequest) {
  const key = `${binding.userId}:${binding.workspaceId}`;
  const running = activeSyncs.get(key);
  if (running) return running;
  const job = runSync(binding, request).finally(() => activeSyncs.delete(key));
  activeSyncs.set(key, job);
  return job;
}
async function runSync(binding: Binding, request: MobileRequest) {
  let sent = 0,
    failed = 0;
  for (const draft of await listDrafts(binding)) {
    if (purgedUsers.has(binding.userId)) break;
    // A process killed after sending may retry the exact same operation after a lease expires.
    if (!(
      (draft.status === "queued" && draft.nextAttemptAt <= Date.now()) ||
      (draft.status === "sending" && draft.updatedAt < Date.now() - 120000)
    ))
      continue;
    const priorUncertain =
      draft.status === "sending" || (draft.uncertainOutcome ?? draft.attempts > 0);
    const claim = await (
      await localDatabase()
    ).runAsync(
      "UPDATE drafts SET status=?,updated_at=? WHERE id=? AND status=? AND updated_at=?",
      "sending",
      Date.now(),
      draft.id,
      draft.status,
      draft.updatedAt,
    );
    if (!claim.changes) continue;
    draft.status = "sending";
    draft.updatedAt = Date.now();
    draft.attempts++;
    draft.validationRejected = false;
    draft.uncertainOutcome = true;
    await persist(draft);
    let recordAttempted = false;
    try {
      await ensureFiles(draft, request);
      const body = {
        ...draft.body,
        ...(draft.files[0]?.fileId ? { receiptFileId: draft.files[0].fileId } : {}),
      };
      recordAttempted = true;
      const result = await request<{ id?: string }>(draft.path, {
        method: "POST",
        body,
        idempotencyKey: draft.operationId,
      });
      draft.resultId = result?.id;
      draft.status = "synced";
      draft.error = undefined;
      draft.validationRejected = false;
      draft.uncertainOutcome = false;
      sent++;
    } catch (error) {
      const value = error as {
        code?: string;
        status?: number;
        message?: string;
        detail?: { code?: string; message?: string };
      };
      const code = (value.detail?.code ?? value.code ?? "NETWORK").toUpperCase();
      const validation =
        [400, 422].includes(value.status ?? 0) &&
        ["VALIDATION_ERROR", "INVALID_REQUEST", "INVALID_INPUT", "VALIDATION_FAILED"].includes(
          code,
        );
      const knownBeforeEffects =
        validation ||
        ([401, 403, 404].includes(value.status ?? 0) && !!(value.detail?.code ?? value.code));
      draft.validationRejected = recordAttempted && validation && !priorUncertain;
      draft.uncertainOutcome = priorUncertain || !knownBeforeEffects;
      Object.assign(draft, nextRetry(draft.attempts, `${code}:${value.status ?? ""}`));
      draft.error =
        value.message ??
        value.detail?.message ??
        "Could not sync. Work is retained on this device.";
      failed++;
    }
    draft.updatedAt = Date.now();
    await persist(draft);
  }
  return { sent, failed };
}
export async function cacheReference(binding: Binding, key: string, value: unknown) {
  if (purgedUsers.has(binding.userId)) return;
  await (
    await localDatabase()
  ).runAsync(
    "INSERT INTO reference_cache(user_id,workspace_id,cache_key,payload,synced_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,workspace_id,cache_key) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at",
    binding.userId,
    binding.workspaceId,
    key,
    JSON.stringify(value),
    Date.now(),
  );
}
export async function readReference<T>(
  binding: Binding,
  key: string,
): Promise<{ data: T; syncedAt: number } | null> {
  const row = await (
    await localDatabase()
  ).getFirstAsync<{ payload: string; synced_at: number }>(
    "SELECT payload,synced_at FROM reference_cache WHERE user_id=? AND workspace_id=? AND cache_key=?",
    binding.userId,
    binding.workspaceId,
    key,
  );
  return row ? { data: JSON.parse(row.payload) as T, syncedAt: row.synced_at } : null;
}
export async function logoutDisposition(userId: string, disposition: "keep" | "discard") {
  if ([...activeSyncs.keys()].some((key) => key.startsWith(`${userId}:`)))
    throw new Error("Wait for sync to finish before signing out.");
  if (disposition === "discard") {
    discardingUsers.add(userId);
    try {
      await removeUserCaptureDirectory(userId);
      const rows = await (
        await localDatabase()
      ).getAllAsync<{ payload: string }>("SELECT payload FROM drafts WHERE user_id=?", userId);
      for (const row of rows) {
        const draft = JSON.parse(row.payload) as Draft;
        await discardDraft(draft, draft.id);
      }
      for (const row of await listState<{
        userId?: string;
        file?: { uri?: string };
        uploadOperationId?: string;
      }>(`file-upload:${userId}:`)) {
        if (row.value.userId !== userId) continue;
        if (row.value.uploadOperationId) discardedUploadOperations.add(row.value.uploadOperationId);
        if (typeof row.value.file?.uri === "string") {
          const file = new File(row.value.file.uri);
          if (file.exists) file.delete();
        }
        await deleteState(row.key);
      }
    } finally {
      discardingUsers.delete(userId);
    }
  }
  await (await localDatabase()).runAsync("DELETE FROM reference_cache WHERE user_id=?", userId);
}

export async function markDraftSynced(binding: Binding, id: string) {
  const draft = await getDraft(binding, id);
  await persist({ ...draft, status: "synced", error: undefined, updatedAt: Date.now() });
}

async function ensureFiles(draft: Draft, request: MobileRequest) {
  for (let index = 0; index < draft.files.length; index++) {
    const item = draft.files[index];
    if (!item.completed) {
      item.uploadOperationId ??= Crypto.randomUUID();
      item.completionOperationId ??= Crypto.randomUUID();
      await persist(draft);
      const upload = item.fileId
        ? await request<{ fileId: string; uploadUrl: string | null; completed: boolean }>(
            `/workspaces/${draft.workspaceId}/files/${item.fileId}/upload-url`,
            { method: "POST", body: {}, idempotencyKey: Crypto.randomUUID() },
          )
        : await request<{ fileId: string; uploadUrl: string | null; completed?: boolean }>(
            `/workspaces/${draft.workspaceId}/files/upload`,
            {
              method: "POST",
              body: { fileName: item.name, mimeType: item.mimeType, sizeBytes: item.sizeBytes },
              idempotencyKey: item.uploadOperationId,
            },
          );
      if (upload.completed) {
        item.completed = true;
        await persist(draft);
        continue;
      }
      if (!upload.uploadUrl)
        throw new Error(
          "The server did not provide a signed upload URL. Your original is retained.",
        );
      item.fileId = upload.fileId;
      await persist(draft);
      const result = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": item.mimeType },
        body: new File(item.uri),
      });
      if (!result.ok) throw new Error(`File upload failed (${result.status}).`);
      await request(`/workspaces/${draft.workspaceId}/files/${item.fileId}/complete`, {
        method: "POST",
        body: {},
        idempotencyKey: item.completionOperationId,
      });
      item.completed = true;
      await persist(draft);
    }
  }
}
export async function uploadDraftFiles(binding: Binding, id: string, request: MobileRequest) {
  const draft = await getDraft(binding, id);
  await ensureFiles(draft, request);
  return draft.files;
}

export async function nativeOperation(userId: string, scope: string) {
  const key = `operation:${userId}:${scope}`;
  let operation = await readState<string>(key);
  if (!operation) {
    operation = Crypto.randomUUID();
    await writeState(key, operation);
  }
  return operation;
}
export async function listState<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  const rows = await (
    await localDatabase()
  ).getAllAsync<{ state_key: string; payload: string }>(
    "SELECT state_key,payload FROM native_state WHERE substr(state_key,1,length(?))=?",
    prefix,
    prefix,
  );
  return rows.map((row) => ({ key: row.state_key, value: JSON.parse(row.payload) as T }));
}

export async function clearWorkspaceReferences(binding: Binding) {
  await (
    await localDatabase()
  ).runAsync(
    "DELETE FROM reference_cache WHERE user_id=? AND workspace_id=?",
    binding.userId,
    binding.workspaceId,
  );
}
/** Account closure overrides retention choices and must also block late in-flight callbacks. */
export async function purgeClosedAccountData(userId: string) {
  purgedUsers.add(userId);
  await removeUserCaptureDirectory(userId);
  const db = await localDatabase();
  const rows = await db.getAllAsync<{ payload: string }>(
    "SELECT payload FROM drafts WHERE user_id=?",
    userId,
  );
  const draftIds = new Set<string>();
  for (const row of rows) {
    const draft = JSON.parse(row.payload) as Draft;
    draftIds.add(draft.id);
    purgedStateIds.add(draft.id);
    for (const item of draft.files) {
      const file = new File(item.uri);
      if (file.exists) file.delete();
    }
  }
  const state = await db.getAllAsync<{ state_key: string; payload: string }>(
    "SELECT state_key,payload FROM native_state",
  );
  const shiftIds = new Set<string>();
  for (const row of state) {
    const value = JSON.parse(row.payload) as { userId?: string } | null;
    if (value?.userId === userId && row.state_key.startsWith("shift:")) {
      shiftIds.add(row.state_key.slice(6));
      purgedStateIds.add(row.state_key.slice(6));
    }
  }
  for (const row of state) {
    const value = JSON.parse(row.payload) as {
      userId?: string;
      file?: { uri?: string };
      uploadOperationId?: string;
    } | null;
    const ownedKey =
      row.state_key.split(":").includes(userId) ||
      value?.userId === userId ||
      [...draftIds].some(
        (id) => row.state_key === `ocr:${id}` || row.state_key === `attachment-target:${id}`,
      ) ||
      (row.state_key === "active-shift" && typeof value === "string" && shiftIds.has(value));
    if (ownedKey) {
      if (row.state_key.startsWith("file-upload:") && value?.userId === userId) {
        if (value.uploadOperationId) discardedUploadOperations.add(value.uploadOperationId);
        if (typeof value.file?.uri === "string") {
          const file = new File(value.file.uri);
          if (file.exists) file.delete();
        }
      }
      await db.runAsync("DELETE FROM native_state WHERE state_key=?", row.state_key);
    }
  }
  await db.runAsync("DELETE FROM drafts WHERE user_id=?", userId);
  await db.runAsync("DELETE FROM reference_cache WHERE user_id=?", userId);
}
