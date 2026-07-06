"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/shared/ui/input";
import { UPLOAD_ACCEPT, isAllowedUploadMime } from "@/shared/constants/file-upload";

/**
 * Standalone upload control for the `/files` page (Phase 11b). Mint a signed
 * upload URL, PUT the bytes straight to Storage, then refresh the list. Files
 * uploaded here are "unlinked" (no entity) — receipts attached to a transaction
 * are uploaded from the Books form with `entityType: "book_transaction"`.
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the upload-url route cap.

export function UploadButton() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>("");

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) {
      setError("File is too large (10 MB max).");
      return;
    }
    // Client-side type gate mirrors the server allowlist.
    if (!isAllowedUploadMime(file.type)) {
      setError("Files must be an image or PDF.");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch("/api/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      });
      if (!res.ok) {
        setError("Couldn't start the upload.");
        return;
      }
      const { uploadUrl } = (await res.json()) as { fileId: string; uploadUrl: string };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        setError("Upload failed. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id="file-upload"
        name="file-upload"
        type="file"
        accept={UPLOAD_ACCEPT}
        disabled={uploading}
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="max-w-xs"
        aria-label="Upload a file"
      />
      {uploading ? <span className="text-xs text-muted-foreground">Uploading…</span> : null}
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}
