import type { FileId, UserId, WorkspaceId } from "@/types/ids";

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
