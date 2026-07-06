import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  files as filesTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
} from "@/server/db/schema";
import { branded, type WorkspaceId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { createFileRecord, getFile, listFiles, listFilesByIds } from "./index";

/**
 * Integration tests for the files platform DB side against a real Postgres.
 * Storage URL minting (`createSignedUploadUrl`/`createSignedReadUrl`) hits
 * Supabase Storage and is not exercised here — it's verified in deployment.
 *
 * Run ONLY when DATABASE_URL is set; otherwise `pnpm test:ci` skips this file:
 *
 *   DATABASE_URL="postgresql://..." pnpm test:ci
 *
 * UUID suffixes `...0000e1`/`...0000e2` are unique to this file (grep before
 * adding a new integration test — a failed beforeAll leaves orphaned rows; run
 * `pnpm db:reset` to recover).
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("files platform integration (requires DATABASE_URL)", () => {
  const actor = branded<"UserId">("00000000-0000-4000-8000-0000000000e1");
  const otherActor = branded<"UserId">("00000000-0000-4000-8000-0000000000e2");
  // A synthetic entity id (UUID — the `files.entity_id` column is uuid; all real
  // entity ids in this system are branded UUIDs).
  const txnEntityId = "00000000-0000-4000-8000-0000000000e4";
  let ws1: WorkspaceId;
  let ws2: WorkspaceId;
  const createdFileIds: string[] = [];

  beforeAll(async () => {
    const db = getDb();
    await db.insert(usersTable).values([
      { id: actor, email: "files-actor@soletrade-test.local", fullName: "Files Actor" },
      { id: otherActor, email: "files-other@soletrade-test.local", fullName: "Files Other" },
    ]);
    ws1 = await createWorkspace(actor, "Files Test One", `files-test-one-${Date.now()}`);
    ws2 = await createWorkspace(otherActor, "Files Test Two", `files-test-two-${Date.now()}`);
  });

  afterAll(async () => {
    const db = getDb();
    const workspaceIds = [ws1!, ws2!].filter(Boolean) as WorkspaceId[];
    if (workspaceIds.length > 0) {
      await db.delete(filesTable).where(inArray(filesTable.workspaceId, workspaceIds));
      await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, workspaceIds));
      await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
    }
    await db.delete(usersTable).where(inArray(usersTable.id, [actor, otherActor]));
  });

  it("creates a record with a workspace-namespaced storage path", async () => {
    const rec = await createFileRecord({
      workspaceId: ws1!,
      uploadedByUserId: actor,
      fileName: "receipt.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      entityType: "book_transaction",
      entityId: txnEntityId,
    });
    createdFileIds.push(rec.id);
    expect(rec.storagePath).toBe(
      `workspaces/${ws1}/book_transaction/${txnEntityId}/${rec.id}/receipt.pdf`,
    );
  });

  it("lists files for the workspace newest-first and isolates per workspace (no IDOR)", async () => {
    // Seed a second ws1 file + a ws2 file that must never appear in ws1 listings.
    const r2 = await createFileRecord({
      workspaceId: ws1!,
      uploadedByUserId: actor,
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
    });
    createdFileIds.push(r2.id);
    await createFileRecord({
      workspaceId: ws2!,
      uploadedByUserId: otherActor,
      fileName: "other.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4096,
    });

    const { items } = await listFiles(ws1!, { limit: 100 });
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((i) => i.workspaceId === ws1)).toBe(true);
    expect(items.find((i) => i.fileName === "other.pdf")).toBeUndefined();
    // Newest-first.
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        items[i]!.createdAt.getTime(),
      );
    }
    // Uploader name resolved via the join.
    expect(items.every((i) => i.uploadedByFullName === "Files Actor")).toBe(true);
  });

  it("filters by entity", async () => {
    const { items } = await listFiles(ws1!, {
      entityType: "book_transaction",
      entityId: txnEntityId,
      limit: 100,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.fileName).toBe("receipt.pdf");
  });

  it("getFile is workspace-scoped (IDOR-safe — cross-workspace id returns null)", async () => {
    const [ws1File] = (await listFiles(ws1!, { limit: 100 })).items;
    expect(ws1File).toBeDefined();
    // Correct workspace → row.
    const ok = await getFile(ws1!, ws1File!.id);
    expect(ok?.fileName).toBe(ws1File!.fileName);
    // Wrong workspace → null even though the id exists.
    const leak = await getFile(ws2!, ws1File!.id);
    expect(leak).toBeNull();
  });

  it("paginates with a keyset cursor and yields no overlapping rows", async () => {
    const first = await listFiles(ws1!, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listFiles(ws1!, { limit: 1, before: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("listFilesByIds is workspace-scoped (drops ids from other workspaces)", async () => {
    const ws2Files = await listFiles(ws2!, { limit: 100 });
    const ws2Id = ws2Files.items[0]!.id;
    // Ask ws1 for a ws2 file id → empty (IDOR-safe).
    const rows = await listFilesByIds(ws1!, [branded<"FileId">(ws2Id)]);
    expect(rows).toHaveLength(0);
  });
});
