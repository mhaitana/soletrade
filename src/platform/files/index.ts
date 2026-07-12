import "server-only";
import { getDataClient } from "@/server/db/client";
import { parsePgTimestamp, unwrap, unwrapMaybe, unwrapVoid } from "@/server/db/helpers";
import type { FileId, UserId, WorkspaceId } from "@/shared/types/ids";
import { branded, newId } from "@/shared/types/ids";
import { writeAudit } from "@/platform/audit";
import { getStorageAdminClient, storageBucket } from "@/server/storage";

/**
 * Files platform service (Phase 11b). Metadata mirror of Supabase Storage objects.
 *
 * Bytes never flow through the app server: the route handler asks
 * `createSignedUploadUrl` for a one-shot PUT URL the client uploads to directly,
 * then `confirmUpload` flips the row to the source of truth. Reads are likewise
 * signed (`createSignedReadUrl`). The Storage client uses the service-role key
 * (bypasses RLS), so every method here re-checks `workspaceId` - Storage RLS is
 * defense-in-depth, code is the boundary.
 *
 * `storagePath` is namespaced `workspaces/{workspaceId}/{entityType ?? "misc"}/
 * {entityId ?? "unlinked"}/{fileId}/{fileName}` so a bucket listing reveals no
 * cross-workspace leakage even if a policy slips.
 */

export interface CreateFileRecordInput {
  workspaceId: WorkspaceId;
  uploadedByUserId: UserId;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  entityType?: string;
  entityId?: string;
}

export interface FileRecord {
  id: FileId;
  workspaceId: WorkspaceId;
  uploadedByUserId: UserId;
  /** Uploader display name (resolved via left join on users). */
  uploadedByFullName: string | null;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

/** Maps a PostgREST files row (+ embedded uploader) to the camelCase `FileRecord`. */
function toFileRecord(r: {
  id: string;
  workspace_id: string;
  uploaded_by_user_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  users: { full_name: string | null } | null;
}): FileRecord {
  return {
    id: branded<"FileId">(r.id),
    workspaceId: branded<"WorkspaceId">(r.workspace_id),
    uploadedByUserId: branded<"UserId">(r.uploaded_by_user_id),
    uploadedByFullName: r.users?.full_name ?? null,
    fileName: r.file_name,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    entityType: r.entity_type,
    entityId: r.entity_id,
    createdAt: parsePgTimestamp(r.created_at),
  };
}

const FILE_COLUMNS =
  "id, workspace_id, uploaded_by_user_id, file_name, storage_path, mime_type, size_bytes, entity_type, entity_id, created_at, users ( full_name )";

/** Cursor for keyset pagination (createdAt desc + id desc tiebreaker). */
export interface FileCursor {
  /**
   * Raw PostgREST ISO string for `created_at` - preserves full µs precision
   * (`now()` is µs-precise; a JS `Date` truncates to ms, breaking the keyset
   * `eq`/`lt` when rows share a millisecond). Kept as a string, never a `Date`.
   */
  createdAt: string;
  id: FileId;
}

export interface FileListOptions {
  /** Restrict to a single entity type, e.g. "book_transaction". */
  entityType?: string;
  /** Restrict to a single entity id (implies same entityType in practice). */
  entityId?: string;
  /** Leading-wildcard ILIKE on `file_name` (index-backed via `pg_trgm` - migration 0017). */
  search?: string;
  limit?: number;
  /** Keyset cursor: return rows strictly before this (createdAt, id). */
  before?: FileCursor;
}

export interface FilePage {
  items: FileRecord[];
  nextCursor: FileCursor | null;
}

/**
 * Build the Storage object key for a new file. Namespaced by workspace so a
 * bucket listing never leaks across workspaces, and by entity so per-entity
 * listings are cheap. The `fileId` segment makes the path unique even when two
 * uploads share a name.
 */
export function buildStoragePath(input: {
  workspaceId: WorkspaceId;
  fileId: FileId;
  fileName: string;
  entityType?: string;
  entityId?: string;
}): string {
  const entity = input.entityType ?? "misc";
  const entityKey = input.entityId ?? "unlinked";
  return `workspaces/${input.workspaceId}/${entity}/${entityKey}/${input.fileId}/${input.fileName}`;
}

/**
 * Insert a file metadata row. Called by the upload-url route after it has minted
 * a signed upload URL - the row is created BEFORE the upload so the path is
 * deterministic, and `confirmUpload` is the (idempotent) mark that bytes landed.
 */
export async function createFileRecord(
  input: CreateFileRecordInput,
): Promise<{ id: FileId; storagePath: string }> {
  const supabase = getDataClient();
  const id = newId<"FileId">();
  const storagePath = buildStoragePath({
    workspaceId: input.workspaceId,
    fileId: id,
    fileName: input.fileName,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  await unwrapVoid(
    supabase.from("files").insert({
      id,
      workspace_id: input.workspaceId,
      uploaded_by_user_id: input.uploadedByUserId,
      file_name: input.fileName,
      storage_path: storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      entity_type: input.entityType,
      entity_id: input.entityId,
    }),
  );
  return { id, storagePath };
}

/**
 * List files for a workspace, newest first. Always scoped to the workspace
 * (IDOR-safe). Optional entity filter + keyset cursor pagination.
 */
export async function listFiles(
  workspaceId: WorkspaceId,
  opts: FileListOptions = {},
): Promise<FilePage> {
  const supabase = getDataClient();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let query = supabase.from("files").select(FILE_COLUMNS).eq("workspace_id", workspaceId);
  if (opts.entityType) query = query.eq("entity_type", opts.entityType);
  if (opts.entityId) query = query.eq("entity_id", opts.entityId);
  const search = opts.search?.trim();
  if (search) query = query.ilike("file_name", `%${search}%`);
  if (opts.before) {
    // Keyset: (created_at, id) strictly < before - i.e. created_at < cursor OR
    // (created_at = cursor AND id < cursor). PostgREST expresses this as an `or`
    // with a nested `and(...)` for the tiebreaker. `opts.before.createdAt` is the
    // raw µs-precision ISO string (see FileCursor) so the comparison is exact.
    const iso = opts.before.createdAt;
    query = query.or(`created_at.lt.${iso},and(created_at.eq.${iso},id.lt.${opts.before.id})`);
  }
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const rows = await unwrap(query);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  // Cursor carries the raw `created_at` string (µs precision) - NOT a Date.
  const nextCursor: FileCursor | null =
    hasMore && last ? { createdAt: last.created_at, id: branded<"FileId">(last.id) } : null;
  return { items: pageRows.map(toFileRecord), nextCursor };
}

/**
 * Fetch a single file, workspace-scoped (IDOR-safe - returns null if the id
 * exists but belongs to another workspace).
 */
export async function getFile(workspaceId: WorkspaceId, id: FileId): Promise<FileRecord | null> {
  const supabase = getDataClient();
  const row = await unwrapMaybe(
    supabase
      .from("files")
      .select(FILE_COLUMNS)
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  );
  return row ? toFileRecord(row) : null;
}

/**
 * Mint a one-shot signed upload URL for a storage path. The client PUTs bytes
 * directly to this URL; our server never sees the bytes.
 */
export async function createSignedUploadUrl(storagePath: string): Promise<string> {
  const client = getStorageAdminClient();
  const { data, error } = await client.storage
    .from(storageBucket())
    .createSignedUploadUrl(storagePath);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to mint upload URL: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

/**
 * Mint a signed read URL (short TTL) for a storage path. The client fetches the
 * bytes directly from Storage; our server never proxies them.
 */
export async function createSignedReadUrl(storagePath: string, ttlSeconds = 60): Promise<string> {
  const client = getStorageAdminClient();
  const { data, error } = await client.storage
    .from(storageBucket())
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Failed to mint read URL: ${error?.message ?? "unknown"}`);
  }
  return data.signedUrl;
}

/**
 * Download a file's bytes server-side (Wave 2 - receipt extraction). Unlike the signed-URL
 * helpers (which hand the client a URL to fetch), this pulls bytes through the app server so
 * they can be fed to the vision model. Uses the service-role admin client (bypasses RLS);
 * the caller is responsible for workspace-scoping (the `storagePath` is namespaced by
 * workspace so a cross-workspace path can't be constructed without the workspace id).
 */
export async function downloadFileBytes(
  storagePath: string,
): Promise<{ bytes: Uint8Array; mimeType: string | null }> {
  const client = getStorageAdminClient();
  const { data, error } = await client.storage.from(storageBucket()).download(storagePath);
  if (error || !data) {
    throw new Error(`Failed to download file: ${error?.message ?? "unknown"}`);
  }
  // Supabase returns a Blob in browser-ish runtimes; in Node it's a Blob with `.arrayBuffer()`.
  const arrayBuffer = await data.arrayBuffer();
  return { bytes: new Uint8Array(arrayBuffer), mimeType: data.type || null };
}

/**
 * Delete a file: remove the Storage object then the metadata row. Workspace-
 * scoped (refuses a file that belongs to another workspace). Writes an audit
 * row and publishes `ReceiptUploaded`'s counterpart is not needed - deletion
 * is a quiet cleanup, recorded only in audit.
 */
export async function deleteFile(
  workspaceId: WorkspaceId,
  id: FileId,
  actorId: UserId,
): Promise<void> {
  const record = await getFile(workspaceId, id);
  if (!record) return; // Idempotent: a missing-or-cross-workspace file is a no-op.
  const client = getStorageAdminClient();
  const { error } = await client.storage.from(storageBucket()).remove([record.storagePath]);
  if (error) {
    // Storage miss shouldn't strand the row - log + proceed to delete metadata.
    console.warn(`Storage delete failed for ${record.storagePath}: ${error.message}`);
  }
  await unwrapVoid(
    getDataClient().from("files").delete().eq("id", id).eq("workspace_id", workspaceId),
  );
  await writeAudit({
    workspaceId,
    actorUserId: actorId,
    action: "file.delete",
    targetType: "file",
    targetId: id,
    metadata: { fileName: record.fileName, sizeBytes: record.sizeBytes },
  });
}

/** Resolve a list of file ids to their records, workspace-scoped (IDOR-safe). */
export async function listFilesByIds(
  workspaceId: WorkspaceId,
  ids: FileId[],
): Promise<FileRecord[]> {
  if (ids.length === 0) return [];
  const supabase = getDataClient();
  const rows = await unwrap(
    supabase.from("files").select(FILE_COLUMNS).eq("workspace_id", workspaceId).in("id", ids),
  );
  return rows.map(toFileRecord);
}
