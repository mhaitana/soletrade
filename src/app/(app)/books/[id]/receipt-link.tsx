"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Paperclip } from "lucide-react";
import type { FileId } from "@/shared/types/ids";

/**
 * "View receipt" link for the Books transaction detail page (Phase 11b). Mints
 * a short-TTL read URL on click and opens the receipt in a new tab — bytes are
 * served by Storage, never proxied through our server.
 */
export function ReceiptLink({ fileId }: { fileId: FileId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  async function open(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/files/${fileId}/read-url`);
      if (!res.ok) {
        setError("Couldn't open the receipt.");
        return;
      }
      const { readUrl } = (await res.json()) as { readUrl: string };
      window.open(readUrl, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={open}>
        <Paperclip className="size-4" aria-hidden />
        View receipt
      </Button>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}
