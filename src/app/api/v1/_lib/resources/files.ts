import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StorageApiError } from "@supabase/supabase-js";
import { branded } from "@/shared/types/ids";
import * as files from "@/platform/files";
import { getDataClient } from "@/server/db/client";
import { unwrap, unwrapMaybe, unwrapVoid } from "@/server/db/helpers";
import { getStorageAdminClient, storageBucket } from "@/server/storage";
import { isAllowedUploadMime } from "@/shared/constants/file-upload";
import { publishEvent } from "@/server/events";
import { writeAudit } from "@/platform/audit";
import { MobileApiError } from "@/platform/mobile/http";
import {
  conflict,
  found,
  gate,
  id,
  keyset,
  keysetPage,
  missing,
  parse,
  type Context,
  type Method,
  type Query,
} from "./common";
const uploadSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((s) => !/[\/\\\u0000]/.test(s), "Filename cannot contain path separators"),
    mimeType: z.string().max(100).refine(isAllowedUploadMime, "Unsupported file type"),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    entityType: z
      .enum(["book_transaction", "drive_expense", "customer", "invoice", "quote"])
      .optional(),
    entityId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.entityType) === Boolean(v.entityId),
    "Entity type and ID must be supplied together",
  );
async function state(ctx: Context, fileId: string) {
  return unwrapMaybe(
    getDataClient()
      .from("files")
      .select("*")
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", fileId)
      .maybeSingle(),
  );
}
async function entity(ctx: Context, type?: string, entityId?: string) {
  if (!type || !entityId) return;
  switch (type) {
    case "book_transaction":
      await gate(ctx, "manage:books", "books");
      found(
        await (
          await import("@/modules/books")
        ).getTransaction(ctx.workspaceId, branded<"BookTransactionId">(entityId)),
      );
      break;
    case "drive_expense":
      await gate(ctx, "manage:drive", "drive");
      found(
        await (
          await import("@/modules/drive")
        ).getExpense(ctx.workspaceId, branded<"DriveExpenseId">(entityId)),
      );
      break;
    case "customer":
      await gate(ctx, "update:customer");
      found(
        await (
          await import("@/platform/customers")
        ).getCustomer(ctx.workspaceId, branded<"CustomerId">(entityId)),
      );
      break;
    case "invoice":
      await gate(ctx, "manage:invoice", "invoices");
      found(
        await (
          await import("@/modules/invoices")
        ).getInvoice(ctx.workspaceId, branded<"InvoiceId">(entityId)),
      );
      break;
    case "quote":
      await gate(ctx, "manage:quote", "quotes");
      found(
        await (
          await import("@/modules/quotes")
        ).getQuote(ctx.workspaceId, branded<"QuoteId">(entityId)),
      );
      break;
    default:
      missing();
  }
}

/** Reconcile stored bytes before either completing metadata or allowing another PUT. */
async function reconcileUpload(
  ctx: Context,
  key: ReturnType<typeof branded<"FileId">>,
  raw: NonNullable<Awaited<ReturnType<typeof state>>>,
  allowMissing: boolean,
): Promise<boolean> {
  await entity(ctx, raw.entity_type ?? undefined, raw.entity_id ?? undefined);
  if (raw.upload_status === "complete") return true;
  const { data, error } = await getStorageAdminClient()
    .storage.from(storageBucket())
    .info(raw.storage_path);
  if (error) {
    // storage-js exposes the HTTP status and service statusCode separately.
    // Only an explicit object miss permits a new non-upsert URL; an outage,
    // auth failure or unknown response must never be treated as missing bytes.
    const notFound =
      error instanceof StorageApiError &&
      (error.status === 404 ||
        (error.status === 400 && ["404", "NoSuchKey"].includes(error.statusCode)));
    if (!notFound)
      throw new MobileApiError("storage_unavailable", "Unable to verify the uploaded object.", 503);
    if (allowMissing) return false;
    conflict("Uploaded object is not available. Upload the bytes before completing.");
  }
  if (!data)
    throw new MobileApiError("storage_unavailable", "Unable to verify the uploaded object.", 503);
  if (Number(data.size) !== raw.size_bytes || data.contentType !== raw.mime_type)
    conflict("Uploaded object's size or content type does not match its metadata.");
  const updated = await unwrap(
    getDataClient()
      .from("files")
      .update({ upload_status: "complete" })
      .eq("workspace_id", ctx.workspaceId)
      .eq("id", key)
      .eq("upload_status", "pending")
      .select("id"),
  );
  if (updated.length) {
    await publishEvent({
      type: "ReceiptUploaded",
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      entityType: raw.entity_type ?? "file",
      entityId: raw.entity_id ?? key,
      metadata: {
        fileId: key,
        fileName: raw.file_name,
        mimeType: raw.mime_type,
        sizeBytes: raw.size_bytes,
      },
    });
    await writeAudit({
      workspaceId: ctx.workspaceId,
      actorUserId: ctx.user.id,
      action: "file.upload",
      targetType: "file",
      targetId: key,
      metadata: { fileName: raw.file_name, sizeBytes: raw.size_bytes },
    });
  } else {
    // A concurrent completion is fine, but a deleted/replaced row is not success.
    if ((await state(ctx, key))?.upload_status !== "complete")
      conflict("Upload metadata changed while completing.");
  }
  return true;
}
async function uploadResult(
  ctx: Context,
  key: ReturnType<typeof branded<"FileId">>,
  raw: NonNullable<Awaited<ReturnType<typeof state>>>,
) {
  const completed = await reconcileUpload(ctx, key, raw, true);
  return {
    fileId: key,
    storagePath: raw.storage_path,
    completed,
    uploadUrl: completed ? null : await files.createSignedUploadUrl(raw.storage_path),
  };
}

export async function readFiles(ctx: Context, p: string[], q: Query) {
  await gate(ctx, "view:file");
  if (p.length === 0) {
    const before = keyset(q);
    let request = getDataClient()
      .from("files")
      .select("id,created_at")
      .eq("workspace_id", ctx.workspaceId)
      .eq("upload_status", "complete");
    if (q.entityType) request = request.eq("entity_type", q.entityType);
    if (q.entityId) request = request.eq("entity_id", q.entityId);
    if (q.search) request = request.ilike("file_name", `%${q.search}%`);
    if (before)
      request = request.or(
        `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
      );
    const raw = await unwrap(
      request
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(q.limit + 1),
    );
    const rows = raw.slice(0, q.limit);
    const last = rows.at(-1);
    const records = await files.listFilesByIds(
      ctx.workspaceId,
      rows.map((r) => branded<"FileId">(r.id)),
    );
    return keysetPage({
      items: rows.map((r) => records.find((f) => f.id === r.id)).filter((r) => r !== undefined),
      nextCursor: raw.length > q.limit && last ? { id: last.id, createdAt: last.created_at } : null,
    });
  }
  const key = branded<"FileId">(id(p[0]));
  const raw = found(await state(ctx, key));
  if (raw.upload_status !== "complete") conflict("Upload has not completed.");
  const row = found(await files.getFile(ctx.workspaceId, key));
  if (p.length === 1) return row;
  if (p.length === 2 && p[1] === "read-url")
    return { url: await files.createSignedReadUrl(row.storagePath) };
  missing();
}
export async function writeFiles(ctx: Context, p: string[], method: Method, body: unknown) {
  await gate(ctx, "manage:file");
  if (p.length === 1 && p[0] === "upload" && method === "POST") {
    const input = parse(uploadSchema, body);
    await entity(ctx, input.entityType, input.entityId);
    const fileId = branded<"FileId">(ctx.operationId ? id(ctx.operationId) : randomUUID());
    const storagePath = files.buildStoragePath({
      workspaceId: ctx.workspaceId,
      fileId,
      fileName: input.fileName,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    let existing = await state(ctx, fileId);
    if (!existing) {
      const payload = {
        id: fileId,
        workspace_id: ctx.workspaceId,
        uploaded_by_user_id: ctx.user.id,
        file_name: input.fileName,
        storage_path: storagePath,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        entity_type: input.entityType,
        entity_id: input.entityId,
        upload_status: "pending",
      };
      try {
        await unwrapVoid(getDataClient().from("files").insert(payload));
      } catch (err) {
        existing = await state(ctx, fileId);
        if (!existing) throw err;
      }
    }
    if (
      existing &&
      (existing.uploaded_by_user_id !== ctx.user.id ||
        existing.file_name !== input.fileName ||
        existing.mime_type !== input.mimeType ||
        existing.size_bytes !== input.sizeBytes ||
        existing.entity_type !== (input.entityType ?? null) ||
        existing.entity_id !== (input.entityId ?? null))
    )
      conflict("Upload operation does not match its original file.");
    return uploadResult(ctx, fileId, existing ?? found(await state(ctx, fileId)));
  }
  const key = branded<"FileId">(id(p[0]));
  const raw = found(await state(ctx, key));
  if (p.length === 2 && p[1] === "upload-url" && method === "POST") {
    parse(z.object({}).strict(), body);
    if (raw.uploaded_by_user_id !== ctx.user.id && ctx.role !== "owner" && ctx.role !== "admin")
      throw new MobileApiError(
        "forbidden",
        "Only the uploader or an administrator can renew this upload.",
        403,
      );
    return uploadResult(ctx, key, raw);
  }
  if (p.length === 1 && method === "DELETE") {
    parse(z.object({}).strict(), body);
    await files.deleteFile(ctx.workspaceId, key, ctx.user.id);
    return { deleted: true };
  }
  if (p.length === 2 && p[1] === "complete" && method === "POST") {
    parse(z.object({}).strict(), body);
    if (raw.uploaded_by_user_id !== ctx.user.id) {
      if (ctx.role !== "owner" && ctx.role !== "admin")
        throw new MobileApiError(
          "forbidden",
          "Only the uploader or an administrator can complete this upload.",
          403,
        );
    }
    await reconcileUpload(ctx, key, raw, false);
    return found(await files.getFile(ctx.workspaceId, key));
  }
  missing();
}

/** A pending metadata row is never evidence that receipt bytes are available. */
export async function assertFileComplete(ctx: Context, fileId: string) {
  const raw = found(await state(ctx, id(fileId)));
  if (raw.upload_status !== "complete")
    conflict("Upload the receipt completely before attaching or extracting it.");
}
