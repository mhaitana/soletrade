import "server-only";
import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db";
import { files, users } from "@/server/db/schema";
import type { FileId, UserId, WorkspaceId } from "@/shared/types/ids";
import { newId } from "@/shared/types/ids";
import { writeAudit } from "@/platform/audit";
import { getStorageAdminClient, storageBucket } from "@/server/storage";

/**
 * Files platform service (Phase 11b). Metadata mirror of Supabase Storage objects.
 *
 * Bytes never flow through the app server: the route handler asks
 * `createSignedUploadUrl` for a one-shot PUT URL the client uploads to directly,
 * then `confirmUpload` flips the row to the source of truth. Reads are likewise
 * signed (`createSignedReadUrl`). The Storage client uses the service-role key
 * (bypasses RLS), so every method here re-checks `workspaceId` — Storage RLS is
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

/** Cursor for keyset pagination (createdAt desc + id desc tiebreaker). */
export interface FileCursor {
  createdAt: Date;
  id: FileId;
}

export interface FileListOptions {
  /** Restrict to a single entity type, e.g. "book_transaction". */
  entityType?: string;
  /** Restrict to a single entity id (implies same entityType in practice). */
  entityId?: string;
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
 * a signed upload URL — the row is created BEFORE the upload so the path is
 * deterministic, and `confirmUpload` is the (idempotent) mark that bytes landed.
 */
export async function createFileRecord(
  input: CreateFileRecordInput,
): Promise<{ id: FileId; storagePath: string }> {
  const db = getDb();
  const id = newId<"FileId">();
  const storagePath = buildStoragePath({
    workspaceId: input.workspaceId,
    fileId: id,
    fileName: input.fileName,
    entityType: input.entityType,
    entityId: input.entityId,
  });
  await db.insert(files).values({
    id,
    workspaceId: input.workspaceId,
    uploadedByUserId: input.uploadedByUserId,
    fileName: input.fileName,
    storagePath,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    entityType: input.entityType,
    entityId: input.entityId,
  });
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
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const conditions: (SQL | undefined)[] = [eq(files.workspaceId, workspaceId)];
  if (opts.entityType) conditions.push(eq(files.entityType, opts.entityType));
  if (opts.entityId) conditions.push(eq(files.entityId, opts.entityId));
  if (opts.before) {
    conditions.push(
      or(
        lt(files.createdAt, opts.before.createdAt),
        and(eq(files.createdAt, opts.before.createdAt), lt(files.id, opts.before.id)),
      ),
    );
  }

  const rows = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      uploadedByUserId: files.uploadedByUserId,
      uploadedByFullName: users.fullName,
      fileName: files.fileName,
      storagePath: files.storagePath,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      entityType: files.entityType,
      entityId: files.entityId,
      createdAt: files.createdAt,
    })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedByUserId))
    .where(and(...conditions))
    .orderBy(desc(files.createdAt), desc(files.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor: FileCursor | null =
    hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;
  return { items, nextCursor };
}

/**
 * Fetch a single file, workspace-scoped (IDOR-safe — returns null if the id
 * exists but belongs to another workspace).
 */
export async function getFile(workspaceId: WorkspaceId, id: FileId): Promise<FileRecord | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      uploadedByUserId: files.uploadedByUserId,
      uploadedByFullName: users.fullName,
      fileName: files.fileName,
      storagePath: files.storagePath,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      entityType: files.entityType,
      entityId: files.entityId,
      createdAt: files.createdAt,
    })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedByUserId))
    .where(and(eq(files.id, id), eq(files.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
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
 * Delete a file: remove the Storage object then the metadata row. Workspace-
 * scoped (refuses a file that belongs to another workspace). Writes an audit
 * row and publishes `ReceiptUploaded`'s counterpart is not needed — deletion
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
    // Storage miss shouldn't strand the row — log + proceed to delete metadata.
    console.warn(`Storage delete failed for ${record.storagePath}: ${error.message}`);
  }
  const db = getDb();
  await db.delete(files).where(and(eq(files.id, id), eq(files.workspaceId, workspaceId)));
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
  const db = getDb();
  const rows = await db
    .select({
      id: files.id,
      workspaceId: files.workspaceId,
      uploadedByUserId: files.uploadedByUserId,
      uploadedByFullName: users.fullName,
      fileName: files.fileName,
      storagePath: files.storagePath,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes,
      entityType: files.entityType,
      entityId: files.entityId,
      createdAt: files.createdAt,
    })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedByUserId))
    .where(and(eq(files.workspaceId, workspaceId), inArray(files.id, ids)));
  return rows;
}
