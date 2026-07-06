"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { formatRelativeTime, formatBytes } from "@/shared/lib/format";
import { deleteFileAction } from "./actions";
import type { FileRecord } from "@/platform/files";

/**
 * Files list (Phase 11b). Each row shows the name, size, uploader, and relative
 * time. "View" mints a short-TTL read URL on click and opens it in a new tab —
 * bytes are served by Storage, never proxied through our server. "Delete" calls
 * the `deleteFileAction` Server Action (manage:file-gated) then refreshes.
 */
export function FilesTable({ items, canManage }: { items: FileRecord[]; canManage: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  async function view(file: FileRecord): Promise<void> {
    setBusyId(file.id);
    setError("");
    try {
      const res = await fetch(`/api/files/${file.id}/read-url`);
      if (!res.ok) {
        setError("Couldn't open this file.");
        return;
      }
      const { readUrl } = (await res.json()) as { readUrl: string };
      window.open(readUrl, "_blank", "noopener,noreferrer");
    } finally {
      setBusyId(null);
    }
  }

  function remove(fileId: string): void {
    setError("");
    startTransition(async () => {
      const res = await deleteFileAction({ fileId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">No files yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload a receipt or document using the control above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-hidden rounded-lg border border-border">
        <ul className="divide-y divide-border">
          {items.map((file) => (
            <li key={file.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{file.fileName}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">{formatBytes(file.sizeBytes)}</span>
                  {file.uploadedByFullName ? <> · {file.uploadedByFullName}</> : null}
                  {" · "}
                  <time dateTime={file.createdAt.toISOString()}>
                    {formatRelativeTime(file.createdAt)}
                  </time>
                  {file.entityType ? <span className="ml-1">· {file.entityType}</span> : null}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busyId === file.id || isPending}
                onClick={() => view(file)}
              >
                View
              </Button>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyId === file.id || isPending}
                  onClick={() => remove(file.id)}
                >
                  Delete
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
