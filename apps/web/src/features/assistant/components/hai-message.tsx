"use client";

import { useState, type FormEvent } from "react";
import { isToolUIPart } from "ai";
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  actionPreviewFor,
  messageMadeChanges,
  messageText,
  type HaiUIMessage,
} from "@/lib/assistant/messages";
import type { MessageRating } from "@/lib/domain/conversations/conversations-types";
import { HaiToolPart } from "@/features/assistant/hooks/use-hai-tool-navigation";
import { HaiMarkdown } from "@/features/assistant/components/hai-markdown";
import { AttachmentChip } from "@/features/assistant/components/receipt-attachment";
import { splitAttachment } from "@/lib/assistant/attachments";

const ACTION_CLASS =
  "inline-flex min-h-8 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 max-md:min-h-11 max-md:px-2.5";

/**
 * One chat message. The person's messages are plain text; hAI's replies render their
 * text as markdown and every tool call as a card (lookups, changes, and changes waiting
 * for approval with the server's preview).
 */
export function HaiMessage({
  message,
  busy,
  isLatest,
  onDecide,
  onRegenerate,
  rating,
  onRate,
  className,
}: {
  message: HaiUIMessage;
  /** A request is in flight: approvals and actions wait. */
  busy: boolean;
  /** The last message in the conversation (only it can be answered again). */
  isLatest: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
  onRegenerate?: (messageId: string) => void;
  /** This person's thumbs up / down on the reply, if any. */
  rating?: MessageRating;
  /** Rate the reply, add a note, or clear the rating (`null`). Resolves true when saved. */
  onRate?: (messageId: string, rating: MessageRating | null, comment?: string) => Promise<boolean>;
  className?: string;
}) {
  const text = messageText(message.parts);
  if (message.role === "user") {
    // An attached receipt travels as the last line of the text; show it as a chip.
    const { text: typed, attachment } = splitAttachment(text);
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "min-w-0 whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground",
            className,
          )}
        >
          {typed}
          {attachment ? (
            <div>
              <AttachmentChip name={attachment.name} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const hasTools = message.parts.some(isToolUIPart);
  const canRegenerate = Boolean(onRegenerate) && isLatest && !messageMadeChanges(message);
  return (
    <div className="flex justify-start">
      <div className={cn("min-w-0 space-y-2 text-sm", className)}>
        {message.parts.map((part, index) => {
          if (part.type === "text" && part.text.trim()) {
            return (
              <div
                key={`${message.id}-text-${index}`}
                className="rounded-lg bg-muted px-3 py-2 text-foreground"
              >
                <HaiMarkdown text={part.text} />
              </div>
            );
          }
          if (isToolUIPart(part)) {
            return (
              <HaiToolPart
                key={part.toolCallId}
                part={part}
                preview={actionPreviewFor(message, part.toolCallId)}
                onDecide={onDecide}
                disabled={busy}
              />
            );
          }
          return null;
        })}
        {!text && !hasTools && busy && isLatest ? (
          <div className="rounded-lg bg-muted px-3 py-2 text-muted-foreground">…</div>
        ) : null}
        {!busy && (text || canRegenerate) ? (
          <div className="flex flex-wrap items-center gap-1">
            {text ? <CopyButton text={text} /> : null}
            {canRegenerate ? (
              <button
                type="button"
                className={ACTION_CLASS}
                onClick={() => onRegenerate?.(message.id)}
                aria-label="Answer again"
                title="Answer again"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                <span className="max-md:sr-only">Answer again</span>
              </button>
            ) : null}
            {/* Only a stored reply can be rated; its id is the stored row's id. */}
            {text && onRate && STORED_ID.test(message.id) ? (
              <FeedbackButtons
                rating={rating}
                onRate={(next, comment) => onRate(message.id, next, comment)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const STORED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thumbs up and down. Either is recorded as soon as it is pressed (pressing it again
 * clears it); a thumbs down then offers a line for what was wrong, which is optional.
 */
function FeedbackButtons({
  rating,
  onRate,
}: {
  rating?: MessageRating;
  onRate: (rating: MessageRating | null, comment?: string) => Promise<boolean>;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "noted" | "failed">("idle");

  async function press(next: MessageRating) {
    const clearing = rating === next;
    setStatus("idle");
    setNoteOpen(next === "down" && !clearing);
    const saved = await onRate(clearing ? null : next);
    if (!saved) {
      setNoteOpen(false);
      setStatus("failed");
    }
  }

  async function sendNote(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    setStatus("saving");
    const saved = await onRate("down", note);
    setStatus(saved ? "noted" : "failed");
    if (saved) {
      setNoteOpen(false);
      setNote("");
    }
  }

  return (
    <>
      <button
        type="button"
        className={cn(ACTION_CLASS, rating === "up" && "text-foreground")}
        onClick={() => void press("up")}
        aria-pressed={rating === "up"}
        aria-label="Good answer"
        title="Good answer"
      >
        <ThumbsUp className={cn("size-3.5", rating === "up" && "fill-current")} aria-hidden />
      </button>
      <button
        type="button"
        className={cn(ACTION_CLASS, rating === "down" && "text-foreground")}
        onClick={() => void press("down")}
        aria-pressed={rating === "down"}
        aria-label="Bad answer"
        title="Bad answer"
      >
        <ThumbsDown className={cn("size-3.5", rating === "down" && "fill-current")} aria-hidden />
      </button>
      {noteOpen ? (
        <form onSubmit={(event) => void sendNote(event)} className="flex w-full items-center gap-2">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            aria-label="What was wrong with this answer? (optional)"
            placeholder="What was wrong? (optional)"
            className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 max-md:h-11"
          />
          <button
            type="submit"
            disabled={!note.trim() || status === "saving"}
            className={cn(ACTION_CLASS, "border border-border text-foreground")}
          >
            {status === "saving" ? "Sending…" : "Send note"}
          </button>
        </form>
      ) : null}
      <span className="text-xs text-muted-foreground" role="status">
        {status === "noted" ? "Thanks, noted." : ""}
        {status === "failed" ? "That could not be saved. Please try again." : ""}
      </span>
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <button
      type="button"
      className={ACTION_CLASS}
      onClick={() => void copy()}
      aria-label={copied ? "Copied" : "Copy reply"}
      title="Copy reply"
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      <span className="max-md:sr-only">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

/** The error under the chat, with a way to try again. */
export function HaiChatError({
  error,
  fallback,
  onRetry,
}: {
  error: Error;
  fallback: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive"
      role="alert"
    >
      <span className="min-w-0 flex-1">{readableError(error) || fallback}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(ACTION_CLASS, "text-destructive hover:text-destructive")}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** The route answers errors as JSON `{ error }`; show the sentence, not the JSON. */
function readableError(error: Error): string {
  const raw = error.message?.trim() ?? "";
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string") return parsed.error;
    } catch {
      return "";
    }
  }
  return raw;
}
