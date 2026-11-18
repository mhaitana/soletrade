"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UPLOAD_ACCEPT, isAllowedUploadMime } from "@/config/file-upload";
import { extractReceiptAction } from "@/features/books/api/receipts/actions";

/**
 * Scan a receipt from the review queue: upload the photo or PDF straight to Storage with a
 * signed URL, then ask the server to read it. The result lands in the queue below for the
 * user to check and apply. Until this existed the web app had no way to start a scan, even
 * though the queue told people to upload one.
 */
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB - matches the upload-url route cap.

type Stage = "idle" | "uploading" | "reading";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "Scan a receipt",
  uploading: "Uploading…",
  reading: "Reading receipt…",
};

export function ScanReceipt({ costLabel }: { costLabel?: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const busy = stage !== "idle";

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) {
      setError("That file is too large (10 MB max).");
      return;
    }
    if (!isAllowedUploadMime(file.type)) {
      setError("Receipts must be an image or PDF.");
      return;
    }
    setStage("uploading");
    try {
      const res = await fetch("/api/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          entityType: "receipt",
        }),
      });
      if (!res.ok) {
        setError("Couldn't start the upload. Please try again.");
        return;
      }
      const { fileId, uploadUrl } = (await res.json()) as { fileId: string; uploadUrl: string };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) {
        setError("The upload failed. Please try again.");
        return;
      }
      setStage("reading");
      const result = await extractReceiptAction({ fileId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Receipt read. Check the details below, then apply it.");
      router.refresh();
    } catch {
      setError("Something went wrong while scanning. Please try again.");
    } finally {
      setStage("idle");
      // Clear the input so choosing the same file again triggers a new scan.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <Button type="button" onClick={() => inputRef.current?.click()} disabled={busy}>
        <ScanLine className="size-4" aria-hidden />
        {STAGE_LABEL[stage]}
      </Button>
      {costLabel ? (
        <p className="text-xs text-muted-foreground">
          Each scan may use {costLabel} of workspace credit.
        </p>
      ) : null}
      <p className="sr-only" role="status">
        {busy ? STAGE_LABEL[stage] : ""}
      </p>
      {error ? (
        <p className="max-w-sm text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
