"use client";

import { useState } from "react";
import { isToolUIPart } from "ai";
import { Check, Copy, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  actionPreviewFor,
  messageMadeChanges,
  messageText,
  type HaiUIMessage,
} from "@/lib/assistant/messages";
import { HaiToolPart } from "@/features/assistant/hooks/use-hai-tool-navigation";
import { HaiMarkdown } from "@/features/assistant/components/hai-markdown";

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
  className,
}: {
  message: HaiUIMessage;
  /** A request is in flight: approvals and actions wait. */
  busy: boolean;
  /** The last message in the conversation (only it can be answered again). */
  isLatest: boolean;
  onDecide: (approvalId: string, approved: boolean) => void;
  onRegenerate?: (messageId: string) => void;
  className?: string;
}) {
  const text = messageText(message.parts);
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={cn(
            "whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground",
            className,
          )}
        >
          {text}
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
          <div className="flex items-center gap-1">
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
          </div>
        ) : null}
      </div>
    </div>
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
