"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { formatBytes } from "@/shared/lib/format";
import type { FileId } from "@/shared/types/ids";

/**
 * Receipt upload control (Phase 11b) — used in the Books transaction form. Bytes
 * go straight to Supabase Storage via a signed upload URL minted by
 * `/api/files/upload-url`; this component only persists the resulting `fileId` and
 * hands it to the parent form through `onChange` (sent to `createTransactionAction`
 * / `updateTransactionAction` as `receiptFileId`).
 *
 * The upload is optional. On edit, an existing `receiptFileId` renders as a
 * "View receipt" link (a read URL is minted on click) plus a Remove button.
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — matches the upload-url route cap.

interface PendingUpload {
  fileId: FileId;
  fileName: string;
  sizeBytes: number;
}

export function ReceiptUpload({
  initialFileId,
  initialFileName,
  onChange,
}: {
  initialFileId?: FileId | null;
  initialFileName?: string | null;
  onChange: (fileId: FileId | null) => void;
}) {
  const [pending, setPending] = useState<PendingUpload | null>(
    initialFileId
      ? { fileId: initialFileId, fileName: initialFileName ?? "Receipt", sizeBytes: 0 }
      : null,
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>("");

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) {
      setError("Receipt is too large (10 MB max).");
      return;
    }
    setUploading(true);
    try {
      // 1. Mint a signed upload URL (creates the metadata row).
      const res = await fetch("/api/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          entityType: "book_transaction",
        }),
      });
      if (!res.ok) {
        setError("Couldn't start the upload.");
        return;
      }
      const { fileId, uploadUrl } = (await res.json()) as {
        fileId: string;
        uploadUrl: string;
      };
      // 2. PUT the bytes straight to Storage (never through our server).
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!put.ok) {
        setError("Upload failed. Try again.");
        return;
      }
      const next: PendingUpload = {
        fileId: fileId as FileId,
        fileName: file.name,
        sizeBytes: file.size,
      };
      setPending(next);
      onChange(next.fileId);
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function viewReceipt(): Promise<void> {
    if (!pending) return;
    const res = await fetch(`/api/files/${pending.fileId}/read-url`);
    if (!res.ok) {
      setError("Couldn't open the receipt.");
      return;
    }
    const { readUrl } = (await res.json()) as { readUrl: string };
    window.open(readUrl, "_blank", "noopener,noreferrer");
  }

  function remove(): void {
    setPending(null);
    onChange(null);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="receipt">Receipt</Label>
      {pending ? (
        <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {pending.fileName}
            {pending.sizeBytes > 0 ? (
              <span className="ml-2 text-muted-foreground tabular-nums">
                {formatBytes(pending.sizeBytes)}
              </span>
            ) : null}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={viewReceipt}>
            View
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={uploading}>
            Remove
          </Button>
        </div>
      ) : (
        <Input
          id="receipt"
          name="receipt"
          type="file"
          accept="image/*,application/pdf"
          disabled={uploading}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      )}
      {uploading ? <p className="text-xs text-muted-foreground">Uploading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
