"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspaceContext } from "@/platform/context";
import { authorize } from "@/platform/permissions";
import { authorizeOrAudit } from "@/server/security";
import { deleteFile, listFiles, type FileListOptions, type FilePage } from "@/platform/files";
import { branded } from "@/shared/types/ids";

export type FilesPageData =
  { access: true; page: FilePage; canManage: boolean } | { access: false };

/**
 * Load a page of files for the workspace. `view:file` gates the list - members
 * without the grant get `access: false` and the page renders a no-access card.
 * `canManage` (manage:file) toggles the upload + delete controls.
 */
export async function loadFilesPage(opts: FileListOptions = {}): Promise<FilesPageData> {
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "view:file")).ok) return { access: false };
  const [page, canManage] = await Promise.all([
    listFiles(ctx.workspaceId, opts),
    Promise.resolve(authorize(ctx.role, "manage:file").ok),
  ]);
  return { access: true, page, canManage };
}

const deleteSchema = z.object({ fileId: z.string().uuid() });

export type DeleteFileResult = { ok: true } | { ok: false; error: string };

export async function deleteFileAction(input: unknown): Promise<DeleteFileResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid file." };
  const ctx = await requireWorkspaceContext();
  if (!(await authorizeOrAudit(ctx, "manage:file")).ok) {
    return { ok: false, error: "You don't have permission to delete files." };
  }
  try {
    await deleteFile(ctx.workspaceId, branded<"FileId">(parsed.data.fileId), ctx.user.id);
    revalidatePath("/files");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete file." };
  }
}
