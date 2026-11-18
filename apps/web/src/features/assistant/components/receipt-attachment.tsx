"use client";

import { useRef, type RefObject } from "react";
import { LoaderCircle, Paperclip, X } from "lucide-react";
import { UPLOAD_ACCEPT } from "@/config/file-upload";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AttachmentState } from "@/features/assistant/hooks/use-receipt-attachment";

/** The paperclip beside a chat input: picks a receipt photo or PDF to attach. */
export function AttachReceiptButton({
  onPick,
  disabled,
  className,
  buttonRef,
}: {
  onPick: (file: File | undefined) => void;
  disabled?: boolean;
  className?: string;
  /** The button itself, so focus can come back to it when the attachment is removed. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          // Clear it so choosing the same file again attaches it again.
          event.target.value = "";
        }}
      />
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon"
        className={cn("text-muted-foreground", className)}
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach a receipt"
        title="Attach a receipt (photo or PDF)"
      >
        <Paperclip className="size-4" aria-hidden />
      </Button>
    </>
  );
}

/** What is attached to the message being written: uploading, ready to send, or failed. */
export function AttachmentStatus({
  state,
  onRemove,
  className,
}: {
  state: AttachmentState;
  onRemove: () => void;
  className?: string;
}) {
  if (state.status === "empty") return null;
  const name = state.status === "ready" ? state.attachment.name : state.name;
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-xs", className)}>
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1",
          state.status === "failed"
            ? "border-destructive/20 bg-destructive/10 text-destructive"
            : "border-border bg-muted text-foreground",
        )}
      >
        {state.status === "uploading" ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Paperclip className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate">{name}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="-mr-1 grid size-5 shrink-0 cursor-pointer place-items-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:size-8"
        >
          <X className="size-3" aria-hidden />
        </button>
      </span>
      <span className="shrink-0 text-muted-foreground" role="status">
        {state.status === "uploading" ? "Uploading…" : ""}
      </span>
      {state.status === "failed" ? (
        <span className="min-w-0 text-destructive" role="alert">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

/** The receipt a sent message carried, shown inside its bubble. */
export function AttachmentChip({ name }: { name: string }) {
  return (
    <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 py-1 text-xs">
      <Paperclip className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}
