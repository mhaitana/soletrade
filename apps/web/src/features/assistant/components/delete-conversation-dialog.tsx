"use client";

import { useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteConversationAction } from "@/features/assistant/api/actions";

/**
 * Asks before deleting a conversation, then deletes it. The assistant page and the side
 * panel's History both use it, so deleting reads and behaves the same in either place.
 */
export function DeleteConversationDialog({
  conversation,
  onCancel,
  onDeleted,
  onCloseAutoFocus,
}: {
  /** The conversation to delete; null keeps the dialog closed. */
  conversation: { id: string; title: string } | null;
  onCancel: () => void;
  onDeleted: (id: string) => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function cancel() {
    setError("");
    onCancel();
  }

  async function confirm(id: string) {
    setError("");
    setPending(true);
    let ok = false;
    try {
      ok = (await deleteConversationAction({ conversationId: id })).ok;
    } catch {
      ok = false;
    }
    setPending(false);
    if (!ok) {
      // Keep the confirmation open and say so: silently doing nothing looked like success.
      setError("The conversation could not be deleted. Please try again.");
      return;
    }
    onDeleted(id);
  }

  return (
    <Dialog
      open={conversation !== null}
      onOpenChange={(open) => {
        if (!open && !pending) cancel();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete this conversation?</DialogTitle>
          <DialogDescription>
            {conversation ? `"${conversation.title}" and its messages` : "This conversation"} will
            be permanently deleted. Records the assistant created or changed are not affected.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => conversation && void confirm(conversation.id)}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
