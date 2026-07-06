import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/platform/context";
import { authorizeOrAudit } from "@/server/security";
import { createFileRecord, createSignedUploadUrl } from "@/platform/files";
import { rateLimit } from "@/server/rate-limit";
import { isAllowedUploadMime } from "@/shared/constants/file-upload";

/**
 * Phase 11b — mint a signed Supabase Storage upload URL. The client PUTs file
 * bytes directly to Storage (bytes never touch this server), then calls the
 * `confirmUploadAction` Server Action to mark the row + link an entity.
 *
 * Auth: resolved workspace context (401 if none). `manage:file` gates uploads.
 * Rate-limited per IP (defense-in-depth against upload spam).
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB cap on a single receipt.

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100).refine(isAllowedUploadMime, "Unsupported file type."),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  entityType: z.string().trim().max(50).optional(),
  entityId: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(await authorizeOrAudit(ctx, "manage:file")).ok) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!(await rateLimit(`upload:${ip}`, { max: 30, windowMs: 60_000 }))) {
    return NextResponse.json({ error: "Too many uploads. Slow down." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  let record: { id: string; storagePath: string };
  try {
    record = await createFileRecord({
      workspaceId: ctx.workspaceId,
      uploadedByUserId: ctx.user.id,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
    });
  } catch {
    return NextResponse.json({ error: "Failed to create file record." }, { status: 500 });
  }

  let uploadUrl: string;
  try {
    uploadUrl = await createSignedUploadUrl(record.storagePath);
  } catch {
    return NextResponse.json({ error: "Failed to mint upload URL." }, { status: 502 });
  }

  return NextResponse.json({
    fileId: record.id,
    storagePath: record.storagePath,
    uploadUrl,
  });
}
