"use client";

import { useRef, useState } from "react";
import { isAllowedUploadMime } from "@/config/file-upload";
import type { ReceiptAttachment } from "@/lib/assistant/attachments";

/** Matches the upload-url route's cap. */
const MAX_BYTES = 10 * 1024 * 1024;

export type AttachmentState =
  | { status: "empty" }
  | { status: "uploading"; name: string }
  | { status: "ready"; attachment: ReceiptAttachment }
  | { status: "failed"; name: string; error: string };

/**
 * One receipt attached to the message being written. The file goes straight to Storage
 * through the same signed-URL upload the Receipts page uses; nothing is read or charged
 * until hAI proposes reading it and the person approves.
 */
export function useReceiptAttachment() {
  const [state, setState] = useState<AttachmentState>({ status: "empty" });
  // Each pick and each removal starts a new turn. An upload that finishes after the
  // person removed it, or after they picked another file, belongs to an old turn and must
  // not put its file (or its error) back.
  const turn = useRef(0);

  async function attach(file: File | undefined): Promise<void> {
    if (!file) return;
    const mine = ++turn.current;
    const show = (next: AttachmentState) => {
      if (turn.current === mine) setState(next);
    };
    const failed = (error: string) => show({ status: "failed", name: file.name, error });
    if (file.size > MAX_BYTES) return failed("That file is too large (10 MB max).");
    if (!isAllowedUploadMime(file.type)) return failed("Receipts must be an image or PDF.");
    show({ status: "uploading", name: file.name });
    try {
      const started = await fetch("/api/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          entityType: "receipt",
        }),
      });
      if (!started.ok) return failed("Couldn't start the upload. Please try again.");
      const { fileId, uploadUrl } = (await started.json()) as { fileId: string; uploadUrl: string };
      if (turn.current !== mine) return;
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) return failed("The upload failed. Please try again.");
      show({ status: "ready", attachment: { fileId, name: file.name } });
    } catch {
      failed("The upload failed. Please try again.");
    }
  }

  return {
    state,
    attach,
    clear() {
      turn.current += 1;
      setState({ status: "empty" });
    },
    /** The uploaded receipt, once it is ready to send. */
    ready: state.status === "ready" ? state.attachment : null,
    uploading: state.status === "uploading",
  };
}
