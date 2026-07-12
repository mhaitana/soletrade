import { NextResponse } from "next/server";
import { tryWorkspaceContext } from "@/platform/context";
import { authorizeOrAudit } from "@/server/security";
import { createSignedReadUrl, getFile } from "@/platform/files";
import { branded } from "@/shared/types/ids";

/**
 * Phase 11b - mint a short-TTL signed Storage read URL for a file the caller can
 * view. Bytes are served by Storage, not proxied through this server. Workspace-
 * scoped via `getFile` (IDOR-safe - a cross-workspace id returns null → 404).
 *
 * Auth: resolved workspace context (401). `view:file` gates reads.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "view:file")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const { id } = await params;
  const file = await getFile(ctx.workspaceId, branded<"FileId">(id));
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const readUrl = await createSignedReadUrl(file.storagePath);
    return NextResponse.json({ readUrl, fileName: file.fileName, mimeType: file.mimeType });
  } catch {
    return NextResponse.json({ error: "Failed to mint read URL." }, { status: 502 });
  }
}
