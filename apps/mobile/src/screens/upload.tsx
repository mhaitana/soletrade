import { useEffect, useRef, useState } from "react";
import type { MobileRequest } from "@soletrade/contracts";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { fetch } from "expo/fetch";
import { Action, Copy, ErrorNotice, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import {
  durableFile,
  readState,
  retireCompletedCapture,
  writeState,
  type DraftFile,
} from "@/offline/store";

type Upload = {
  userId: string;
  workspaceId: string;
  file: DraftFile;
  uploadOperationId: string;
  completionOperationId: string;
  fileId?: string;
  storagePath?: string;
  completed?: boolean;
};
type UploadURL = {
  fileId: string;
  storagePath?: string;
  completed?: boolean;
  uploadUrl: string | null;
};
export function UploadScreen() {
  const { request, userId, workspaceId } = useSession();
  return (
    <BoundUpload
      key={`${userId}:${workspaceId}`}
      request={request}
      userId={userId}
      workspaceId={workspaceId}
    />
  );
}
function BoundUpload({
  request,
  userId,
  workspaceId,
}: {
  request: MobileRequest;
  userId: string;
  workspaceId: string;
}) {
  const stateKey = `file-upload:${userId}:${workspaceId}`;
  const [upload, setUpload] = useState<Upload | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    active.current = true;
    void readState<Upload>(stateKey)
      .then((saved) => {
        if (!active.current) return;
        if (saved && saved.userId === userId && saved.workspaceId === workspaceId) setUpload(saved);
        setReady(true);
      })
      .catch(() => {
        if (active.current) {
          setError("Could not restore your selected file. Reopen this screen to retry.");
        }
      });
    return () => {
      active.current = false;
    };
  }, [stateKey, userId, workspaceId]);
  const assertActive = () => {
    if (!active.current)
      throw new Error("The upload belongs to another screen or workspace. Reopen it to continue.");
  };
  const persist = async (value: Upload) => {
    assertActive();
    await writeState(stateKey, value);
    assertActive();
    setUpload({ ...value });
  };
  const pick = async () => {
    if (!ready || saving.current) return;
    setError("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: ["application/pdf", "image/*"],
      });
      if (result.canceled) return;
      assertActive();
      if (upload?.completed === true && upload.fileId) {
        await retireCompletedCapture({ userId, workspaceId }, upload.file, {
          fileId: upload.fileId,
          completed: true,
        });
        assertActive();
      }
      const asset = result.assets[0];
      const file = await durableFile(
        { userId, workspaceId },
        asset.uri,
        asset.name,
        asset.mimeType ?? "application/octet-stream",
      );
      await persist({
        userId,
        workspaceId,
        file,
        uploadOperationId: file.uploadOperationId ?? Crypto.randomUUID(),
        completionOperationId: file.completionOperationId ?? Crypto.randomUUID(),
      });
    } catch (cause) {
      if (active.current) setError(String(cause));
    }
  };
  const save = async () => {
    if (!upload || saving.current || !ready) return;
    saving.current = true;
    setBusy(true);
    setError("");
    const pending = { ...upload };
    try {
      const { file } = pending;
      if (file.sizeBytes > 10 * 1024 * 1024) throw new Error("Choose a file smaller than 10 MB.");
      assertActive();
      if (!pending.fileId) {
        const created = await request<UploadURL>(`/workspaces/${workspaceId}/files/upload`, {
          method: "POST",
          body: { fileName: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes },
          idempotencyKey: pending.uploadOperationId,
        });
        pending.fileId = created.fileId;
        pending.storagePath = created.storagePath;
        pending.completed = created.completed;
        await persist(pending);
      }
      if (!pending.completed) {
        // Renew on every explicit attempt; replaying the create response may contain an expired URL.
        const renewed = await request<UploadURL>(
          `/workspaces/${workspaceId}/files/${pending.fileId}/upload-url`,
          {
            method: "POST",
            body: {},
            idempotencyKey: Crypto.randomUUID(),
          },
        );
        assertActive();
        if (renewed.fileId !== pending.fileId)
          throw new Error("The server returned a different file. Your original is retained.");
        pending.storagePath = renewed.storagePath;
        pending.completed = renewed.completed;
        await persist(pending);
        if (!pending.completed) {
          if (!renewed.uploadUrl) throw new Error("No upload URL was returned. Retry to renew it.");
          assertActive();
          const response = await fetch(renewed.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.mimeType },
            body: new File(file.uri),
          });
          assertActive();
          if (!response.ok) throw new Error("Upload interrupted. Retry to complete the same file.");
          await request(`/workspaces/${workspaceId}/files/${pending.fileId}/complete`, {
            method: "POST",
            body: {},
            idempotencyKey: pending.completionOperationId,
          });
          pending.completed = true;
          await persist(pending);
        }
      }
      assertActive();
      if (!pending.fileId || pending.completed !== true)
        throw new Error("Upload completion is not confirmed. Your original is retained.");
      await retireCompletedCapture({ userId, workspaceId }, file, {
        fileId: pending.fileId,
        completed: true,
      });
      assertActive();
      await writeState(stateKey, null);
      assertActive();
      router.back();
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not upload. Your selected file is retained.",
        );
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <Screen>
      <Copy variant="title">Upload a file</Copy>
      <Copy muted>
        PDF and image files up to 10 MB. Connect to upload into the shared workspace.
      </Copy>
      {!ready && <Copy muted>Restoring selected file…</Copy>}
      <Action title="Choose file" secondary disabled={busy || !ready} onPress={() => void pick()} />
      {upload && (
        <>
          <Copy>{upload.file.name}</Copy>
          <Copy muted>{(upload.file.sizeBytes / 1024).toFixed(0)} KB</Copy>
          <Action title="Upload file" busy={busy} onPress={() => void save()} />
        </>
      )}
      {error && <ErrorNotice message={error} />}
    </Screen>
  );
}
