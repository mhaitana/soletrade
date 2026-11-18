"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Trash2,
  X,
} from "lucide-react";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import type { ConversationSummary } from "@/lib/domain/conversations/conversations-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listPanelConversationsAction } from "@/features/assistant/api/actions";
import { DeleteConversationDialog } from "@/features/assistant/components/delete-conversation-dialog";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; conversations: ConversationSummary[] };

/**
 * The side panel's History: the person's conversations, listed inside the panel. Picking
 * one opens it in the panel's own chat, so history and chat stay in one window (on a phone
 * the panel fills the screen, and the assistant page would be a second, different chat).
 */
export function HaiPanelHistory({
  activeId,
  fullPageHref,
  onOpen,
  onDeleted,
  onNew,
  onBack,
  onClose,
}: {
  /** The conversation the panel's chat is showing, if any. */
  activeId: string | null;
  /** The assistant page, for renaming and write tools. */
  fullPageHref: string;
  /** Show a conversation in the panel's chat. Resolves false when it no longer exists. */
  onOpen: (id: string) => Promise<boolean>;
  onDeleted: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const conversations = await listPanelConversationsAction();
        if (!cancelled) setLoad({ status: "ready", conversations });
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Announce the view to screen readers and keep keyboard focus inside the panel.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  function forget(id: string) {
    setLoad((current) =>
      current.status === "ready"
        ? { status: "ready", conversations: current.conversations.filter((c) => c.id !== id) }
        : current,
    );
  }

  async function open(id: string) {
    if (opening) return;
    setOpenError("");
    setOpening(id);
    let found: boolean;
    try {
      found = await onOpen(id);
    } catch {
      setOpening(null);
      setOpenError("The conversation could not be opened. Please try again.");
      return;
    }
    // Opened: the panel is back on its chat and this view is gone.
    if (found) return;
    setOpening(null);
    forget(id);
    setOpenError("That conversation is no longer available.");
  }

  return (
    <>
      {/* The title and the two controls on the right sit where the chat header has them. */}
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-ml-3 size-11 xl:-ml-1 xl:size-9"
          onClick={onBack}
          aria-label="Back to chat"
        >
          <ArrowLeft className="size-4" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
            History
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            Your {brand.assistantName} conversations
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 xl:size-9"
          onClick={onNew}
          aria-label={`Start a new ${brand.assistantName} conversation`}
          title="New conversation"
        >
          <MessageSquarePlus className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 xl:size-9"
          onClick={onClose}
          aria-label={`Close ${brand.assistantName}`}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {openError ? (
          <p className="mb-3 text-sm text-destructive" role="alert">
            {openError}
          </p>
        ) : null}
        {load.status === "loading" ? (
          <div className="space-y-2" role="status" aria-label="Loading conversations">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : load.status === "error" ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground" role="alert">
              Your conversations could not be loaded.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setLoad({ status: "loading" });
                setAttempt((current) => current + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : load.conversations.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center py-6 text-center">
            <History className="size-7 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-medium">No conversations yet</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Ask {brand.assistantName} something and the conversation is kept here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Conversations">
            {load.conversations.map((conversation) => {
              const id = conversation.id as string;
              const isCurrent = id === activeId;
              return (
                <li
                  key={id}
                  className={cn(
                    "flex items-stretch rounded-lg border transition-colors",
                    isCurrent
                      ? "border-brand-blue/40 bg-brand-blue/5"
                      : "border-border bg-card hover:bg-muted/40",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void open(id)}
                    disabled={opening !== null}
                    aria-current={isCurrent ? "true" : undefined}
                    className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-l-lg px-3 py-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{conversation.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {isCurrent ? "Open now · " : ""}
                        <time dateTime={conversation.updatedAt.toISOString()}>
                          {formatRelativeTime(conversation.updatedAt)}
                        </time>
                      </span>
                    </span>
                    {opening === id ? (
                      <LoaderCircle
                        className="size-4 shrink-0 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      deleteButtonRef.current = event.currentTarget;
                      setConfirmDelete({ id, title: conversation.title });
                    }}
                    disabled={opening !== null}
                    aria-label={`Delete conversation ${conversation.title}`}
                    className="grid w-11 shrink-0 cursor-pointer place-items-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="sr-only" aria-live="polite">
          {opening ? "Opening conversation…" : ""}
        </p>
      </div>

      <div className="shrink-0 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button asChild variant="outline" className="w-full">
          <Link href={fullPageHref} onClick={onClose}>
            Open full page
            <ArrowUpRight className="size-4" aria-hidden />
          </Link>
        </Button>
        <p className="mt-2 px-1 text-center text-[0.7rem] text-muted-foreground">
          Rename conversations and manage write tools there.
        </p>
      </div>

      <DeleteConversationDialog
        conversation={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onDeleted={(id) => {
          setConfirmDelete(null);
          forget(id);
          onDeleted(id);
        }}
        onCloseAutoFocus={() => {
          // Back to the row's delete button, or to the heading when the row is gone.
          const button = deleteButtonRef.current;
          if (button?.isConnected) button.focus();
          else headingRef.current?.focus();
        }}
      />
    </>
  );
}
