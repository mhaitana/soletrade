import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { FileId, UserId, WorkspaceId } from "@/shared/types/ids";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * Files platform schema (Phase 11b). One row per uploaded file — the metadata
 * mirror of an object stored in Supabase Storage. Workspace-scoped.
 *
 * Bytes never flow through the app server: the client asks our `upload-url`
 * route for a signed Supabase Storage upload URL, PUTs the bytes directly to
 * Storage, then calls `confirmUpload` to mark the row as the source of truth.
 * Read URLs are likewise signed and served by Storage. The server uses the
 * service-role admin client (bypasses RLS), so workspace scoping is enforced in
 * code here, not at the DB row level — Storage RLS is defense-in-depth only.
 *
 * `storagePath` is the Supabase Storage object key, of the form
 * `workspaces/{workspaceId}/{entityType ?? "misc"}/{entityId ?? "unlinked"}/{fileId}/{fileName}`.
 *
 * `entityType`/`entityId` are an optional soft link to the entity this file
 * belongs to (e.g. `entityType = "book_transaction"`, `entityId = <txn id>`).
 * No FK constraint — cross-module decoupling, mirroring `sourceInvoiceId` on
 * `book_transactions`. The Books receipt link is `book_transactions.receiptFileId`
 * (also no FK); both columns are nullable so a file can outlive its link and
 * vice-versa.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().$type<FileId>().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .$type<WorkspaceId>()
      .references(() => workspaces.id),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .$type<UserId>()
      .references(() => users.id),
    /** Original client-side file name (display only; the stored key uses the id). */
    fileName: text("file_name").notNull(),
    /** Supabase Storage object key. */
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    /** File size in bytes (integer — never a float). */
    sizeBytes: integer("size_bytes").notNull(),
    /** Soft link: the kind of entity this file belongs to (e.g. "book_transaction"). */
    entityType: text("entity_type"),
    /** Soft link: the id of the entity this file belongs to (no FK — decoupled). */
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    // Primary list view is "newest first"; secondary order keeps ties deterministic.
    index("files_workspace_created_idx").on(t.workspaceId, t.createdAt),
    // Lookup of all files attached to a given entity (e.g. a transaction's receipts).
    index("files_workspace_entity_idx").on(t.workspaceId, t.entityType, t.entityId),
  ],
);
