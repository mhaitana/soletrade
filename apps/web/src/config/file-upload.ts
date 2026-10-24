/**
 * File-upload MIME allowlist (brief §13 - "file upload type validation").
 *
 * The server boundary (`/api/files/upload-url`) enforces this via a Zod refine;
 * the UI `accept` attribute mirrors it so the OS picker only offers valid types.
 * Receipts and generic workspace files share the same allowlist: raster images
 * (incl. HEIC/HEIF from iPhones) + PDF. `image/svg+xml` is intentionally excluded
 * (script-carrying risk for a receipts/files store), as are archives, executables,
 * and arbitrary `application/*` types.
 */

export const ALLOWED_UPLOAD_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
  "application/pdf",
] as const;

export type AllowedUploadMimeType = (typeof ALLOWED_UPLOAD_MIME_TYPES)[number];

const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_UPLOAD_MIME_TYPES);

/** True iff `mime` is one of the allowed upload types (case-sensitive, trimmed first). */
export function isAllowedUploadMime(mime: string): boolean {
  return ALLOWED_SET.has(mime.trim());
}

/** `accept` string for `<input type="file">`, matching the server allowlist 1:1. */
export const UPLOAD_ACCEPT = ALLOWED_UPLOAD_MIME_TYPES.join(",");
