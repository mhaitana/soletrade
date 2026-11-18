"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, History, Pencil, Plus, Search, Send, Sparkles, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { brand } from "@/config/brand";
import { formatRelativeTime } from "@/lib/format";
import { withAttachment } from "@/lib/assistant/attachments";
import { storedToUIMessage, type HaiUIMessage } from "@/lib/assistant/messages";
import { renameConversationAction, type AssistantPageData } from "@/features/assistant/api/actions";
import {
  toolCallIdsOf,
  useHaiToolNavigation,
} from "@/features/assistant/hooks/use-hai-tool-navigation";
import { loadConversation } from "@/features/assistant/hooks/load-conversation";
import { useConversationList } from "@/features/assistant/hooks/use-conversation-list";
import { publishHaiEvent, useHaiEvents } from "@/features/assistant/hooks/use-hai-events";
import { useHaiChat } from "@/features/assistant/hooks/use-hai-chat";
import { useMessageFeedback } from "@/features/assistant/hooks/use-message-feedback";
import { useReceiptAttachment } from "@/features/assistant/hooks/use-receipt-attachment";
import { useStickToBottom } from "@/features/assistant/hooks/use-stick-to-bottom";
import { DeleteConversationDialog } from "@/features/assistant/components/delete-conversation-dialog";
import { HaiChatError, HaiMessage } from "@/features/assistant/components/hai-message";
import { HaiStarters } from "@/features/assistant/components/hai-starters";
import {
  AttachReceiptButton,
  AttachmentStatus,
} from "@/features/assistant/components/receipt-attachment";
import { WriteToolsSwitch } from "@/features/assistant/components/write-tools-switch";

/**
 * The assistant page chat. The conversation is stored on the server (whole messages,
 * including tool calls and their approval state), so reopening it shows exactly what
 * happened, and changes still waiting for approval can be approved after a reload.
 *
 * The first message creates the conversation; the route returns its id in
 * `X-Conversation-Id`, and the URL is updated with `history.replaceState` so the stream
 * in flight is not interrupted. The conversation list refreshes when each reply finishes.
 *
 * The page is laid out like the other workspace pages: a title with its main action, the
 * conversation list in the shared table chrome, and the chat in a card that starts an
 * empty conversation the same way the side panel does.
 *
 * On a phone or tablet the title row and the chat together are exactly as tall as the
 * visible screen, so the input is always on screen above the bottom bar and only the
 * messages scroll; the conversation list follows below. On a wide screen the list sits
 * beside the chat.
 */
const SUGGESTED_PROMPTS = [
  "How's my business doing this month?",
  "List my overdue invoices",
  "What's my cash position?",
  "Who are my recent customers?",
];

/** How long after a new conversation's first reply to look for the title hAI gives it. */
const TITLE_REFRESH_MS = 6000;

function formatDate(d: Date): string {
  return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function AssistantChat({
  initialConversations,
  hasMoreConversations = false,
  activeConversation,
  initialFeedback,
  canAttachReceipts = false,
}: {
  initialConversations: AssistantPageData["conversations"];
  hasMoreConversations?: boolean;
  activeConversation: AssistantPageData["activeConversation"];
  initialFeedback?: AssistantPageData["feedback"];
  /** Books is installed and this person may add receipts, so the input offers to attach one. */
  canAttachReceipts?: boolean;
}) {
  const router = useRouter();
  const initialId = activeConversation?.id ?? null;
  const [input, setInput] = useState("");
  // Deleting a conversation and switching write tools on both ask first.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  // A name saved here, shown until the server's copy of the title changes (it then has the
  // new name, or a newer one such as the title hAI writes after the first reply).
  const [renamed, setRenamed] = useState<{ title: string; over: string | null } | null>(null);
  // Write-tools opt-in, seeded from the server-loaded conversation.
  const [writeEnabled, setWriteEnabled] = useState<boolean>(
    activeConversation?.writeEnabled ?? false,
  );

  // Stored messages, whole. `useState` lazy init runs once; the page remounts this
  // component (`key={c}`) when switching conversations.
  const [initialMessages] = useState<HaiUIMessage[]>(() =>
    (activeConversation?.messages ?? []).map(storedToUIMessage),
  );
  // Tool calls that already ran before this page load must not navigate again.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => toolCallIdsOf(initialMessages));

  const chat = useHaiChat({
    surface: "page",
    chatId: initialId ?? "assistant-new",
    conversationId: initialId,
    initialMessages,
    onConversationCreated: (id) => window.history.replaceState(null, "", `/assistant?c=${id}`),
    onFinish: () => {
      router.refresh();
      // A new conversation gets its title from hAI a moment after the first reply, so
      // look once more for it. Not tied to this component: the refresh above remounts the
      // page on the conversation's own address.
      if (!initialId) {
        window.setTimeout(() => {
          if (window.location.pathname === "/assistant") router.refresh();
        }, TITLE_REFRESH_MS);
      }
    },
  });
  const { messages, busy, error, conversationId } = chat;
  useHaiToolNavigation(messages, settled);
  const feedback = useMessageFeedback(initialFeedback);
  const attachment = useReceiptAttachment();
  // The server renders the newest page; searching and "show more" load the rest here.
  const list = useConversationList({
    conversations: initialConversations,
    hasMore: hasMoreConversations,
  });
  const {
    attach: attachThread,
    onScroll: onThreadScroll,
    follow: followThread,
  } = useStickToBottom<HTMLDivElement>();
  const cardRef = useRef<HTMLDivElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  // Where focus goes after "Show more": the first of the rows it adds.
  const focusRowAfterMore = useRef<number | null>(null);

  // Bring the whole chat (and so its input) back onto the screen when a stored
  // conversation opens and when a turn starts (not when it ends: the person may have
  // scrolled away to the list by then). The layout already fits the chat on the screen
  // at the top of the page, so this only moves anything when the page has been scrolled
  // or the screen is too short to hold the chat (a phone on its side).
  const opensWithMessages = initialMessages.length > 0;
  useEffect(() => {
    if (opensWithMessages) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [opensWithMessages]);
  useEffect(() => {
    if (busy) cardRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [busy]);

  function send(text: string) {
    if (!text.trim() || busy) return;
    followThread();
    chat.send(text);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = withAttachment(input, attachment.ready);
    if (!text || busy || attachment.uploading) return;
    send(text);
    setInput("");
    attachment.clear();
  }

  /** Show this conversation as the server now has it (the panel added to it). */
  async function showLatest(id: string): Promise<void> {
    try {
      const latest = await loadConversation(id);
      if (!latest) return;
      setSettled(latest.settled);
      setWriteEnabled(latest.writeEnabled);
      feedback.reset(latest.feedback);
      chat.restore(latest.id, latest.messages);
    } catch {
      // Keep what is on screen; a reload shows the rest.
    }
  }

  // What the side panel did while this page was on screen. While a reply is arriving here
  // nothing is refreshed: the page refreshes itself when its turn ends, and a refresh
  // mid-reply would remount a conversation that is still being created.
  useHaiEvents("page", (event) => {
    const showing = event.id === conversationId;
    if (event.type === "conversation-updated") {
      if (busy) return;
      router.refresh();
      if (showing) void showLatest(event.id);
    } else if (event.type === "conversation-deleted") {
      list.remove(event.id);
      if (showing) router.push("/assistant");
      else if (!busy) router.refresh();
    } else if (showing) {
      setWriteEnabled(event.enabled);
    }
  });

  function changeWriteEnabled(enabled: boolean) {
    setWriteEnabled(enabled);
    if (conversationId) {
      publishHaiEvent("page", { type: "write-tools-changed", id: conversationId, enabled });
    }
  }

  function onDeleted(id: string) {
    setConfirmDelete(null);
    list.remove(id);
    publishHaiEvent("page", { type: "conversation-deleted", id });
    if (id === conversationId || id === initialId) {
      router.push("/assistant");
    } else {
      router.refresh();
    }
  }

  const serverTitle =
    initialConversations.find((c) => c.id === conversationId)?.title ??
    (activeConversation && activeConversation.id === conversationId
      ? activeConversation.title
      : null);

  async function onRename(e: FormEvent) {
    e.preventDefault();
    const id = conversationId;
    if (!id || renameDraft === null) return;
    setRenaming(true);
    setRenameError("");
    try {
      const result = await renameConversationAction({ conversationId: id, title: renameDraft });
      if (!result.ok) {
        setRenameError(result.error);
        return;
      }
      setRenamed({ title: result.title, over: serverTitle });
      setRenameDraft(null);
      router.refresh();
    } catch {
      setRenameError("The conversation could not be renamed. Please try again.");
    } finally {
      setRenaming(false);
    }
  }

  const activeId = conversationId;
  const hasMessages = messages.length > 0;
  const displayTitle = renamed && renamed.over === serverTitle ? renamed.title : serverTitle;
  // A conversation opened from beyond the listed ones still gets its row, so it can be
  // seen as open and deleted from the list.
  const rows =
    !list.term &&
    activeConversation &&
    activeConversation.id === activeId &&
    !list.conversations.some((c) => c.id === activeId)
      ? [
          {
            id: activeConversation.id,
            title: activeConversation.title,
            updatedAt: activeConversation.updatedAt,
          },
          ...list.conversations,
        ]
      : list.conversations;

  // After "Show more", focus moves to the first row it added: the button may be gone.
  useEffect(() => {
    const from = focusRowAfterMore.current;
    if (from === null || list.loadingMore) return;
    focusRowAfterMore.current = null;
    listRef.current?.querySelectorAll<HTMLElement>("li a")[from]?.focus();
  }, [list.loadingMore, rows.length]);

  return (
    <div>
      {/* A wide screen is a grid: the title across the top, the list beside the chat. Below
          that the title and the chat are one column exactly as tall as the visible screen
          (under the top bar, above a phone's bottom bar), and the list follows it. The chat
          comes first in the page so the keyboard reaches the input before the list. */}
      <div className="lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 max-lg:min-h-104 max-md:h-[calc(100dvh-10rem-env(safe-area-inset-bottom))] md:max-lg:h-[calc(100dvh-7.5rem)] lg:contents">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:col-span-2">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">
                {brand.assistantName} assistant
              </h1>
              {/* A phone keeps the title row to one line: the chat needs the height. */}
              <p className="text-sm text-muted-foreground max-sm:sr-only">
                Ask about your workspace and pick up past conversations.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Below the chat on a phone or tablet, so offer a way straight to it. */}
              {initialConversations.length > 0 ? (
                <Button asChild variant="outline" className="lg:hidden">
                  <a href="#conversations">
                    <History className="size-4 sm:hidden" aria-hidden />
                    <span className="max-sm:sr-only">Conversations</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {initialConversations.length}
                      {hasMoreConversations ? "+" : ""}
                    </span>
                  </a>
                </Button>
              ) : null}
              <Button asChild>
                <Link href="/assistant">
                  <Plus className="size-4" aria-hidden />
                  {/* A phone shows the short label; the link is still named in full. */}
                  <span className="sm:hidden" aria-hidden>
                    New
                  </span>
                  <span className="max-sm:sr-only">New conversation</span>
                </Link>
              </Button>
            </div>
          </div>

          {/* Chat */}
          {/* The card takes the height the screen has left and the messages scroll inside it,
            so the input never scrolls away. */}
          <Card
            ref={cardRef}
            className="@container min-h-0 flex-1 scroll-mt-20 gap-0 overflow-hidden py-0 max-md:scroll-mb-16 md:scroll-mb-6 lg:col-start-2 lg:row-start-2 lg:h-[calc(100dvh-12rem)] lg:flex-none"
          >
            <header className="flex items-center gap-3 border-b border-border px-4 py-3">
              <span className="grid size-9 place-items-center rounded-lg border border-brand-blue/25 bg-brand-blue/5 text-brand-blue">
                <Sparkles className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <h2 className="truncate text-sm font-semibold">
                    {activeId && displayTitle ? displayTitle : "New conversation"}
                  </h2>
                  {activeId && displayTitle ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRenameError("");
                        setRenameDraft(displayTitle);
                      }}
                      disabled={busy}
                      aria-label="Rename conversation"
                      title="Rename conversation"
                      className="-my-2 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-default disabled:opacity-50 max-md:size-11"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {activeConversation ? (
                    <>
                      Last active{" "}
                      <time
                        dateTime={activeConversation.updatedAt.toISOString()}
                        suppressHydrationWarning
                      >
                        {formatDate(activeConversation.updatedAt)}
                      </time>
                    </>
                  ) : (
                    "Saved once you send a message."
                  )}
                </p>
              </div>
            </header>

            {/* Messages. Only the status line below is announced, not every streamed token.
                The suggestions of an empty conversation are read from their top, so the list
                only starts following its newest content once there are messages. */}
            <div
              ref={hasMessages ? attachThread : undefined}
              onScroll={onThreadScroll}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
            >
              {!hasMessages ? (
                <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center lg:py-6">
                  {/* Side by side on a phone, where the height is needed for the suggestions. */}
                  <div className="flex items-center gap-2.5 sm:block">
                    <Bot className="size-7 shrink-0 text-brand-blue" aria-hidden />
                    <h3 className="text-base font-semibold sm:mt-3">Ask about your business</h3>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    The assistant reads real workspace data - invoices, books, customers.
                  </p>
                  <HaiStarters
                    prompts={SUGGESTED_PROMPTS}
                    onPick={send}
                    disabled={busy}
                    className="mt-5 grid gap-2 @lg:grid-cols-2"
                  />
                </div>
              ) : (
                messages.map((m, index) => (
                  <HaiMessage
                    key={m.id}
                    message={m}
                    busy={busy}
                    isLatest={index === messages.length - 1}
                    onDecide={chat.decide}
                    onRegenerate={chat.regenerate}
                    rating={feedback.ratings[m.id]}
                    onRate={feedback.rate}
                    className="max-w-[85%]"
                  />
                ))
              )}
              {error ? (
                <HaiChatError
                  error={error}
                  fallback="Something went wrong. Please try again."
                  onRetry={hasMessages ? chat.retry : undefined}
                />
              ) : null}
            </div>
            {/* Outside the scrolling area, where it would add a sliver of empty scroll. */}
            <p className="sr-only" aria-live="polite">
              {busy ? `${brand.assistantName} is answering…` : ""}
            </p>

            {/* Input */}
            <div className="border-t border-border p-3">
              <AttachmentStatus
                state={attachment.state}
                onRemove={() => {
                  attachment.clear();
                  // The chip, and with it the focused remove button, is gone. The paperclip is
                  // disabled while a file uploads, so focus it once this removal has rendered.
                  window.setTimeout(() => attachButtonRef.current?.focus(), 0);
                }}
                className="mb-2"
              />
              <form onSubmit={onSubmit} className="flex items-end gap-2">
                {canAttachReceipts ? (
                  <AttachReceiptButton
                    buttonRef={attachButtonRef}
                    onPick={(file) => void attachment.attach(file)}
                    disabled={busy || attachment.uploading}
                  />
                ) : null}
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit(e as unknown as FormEvent);
                    }
                  }}
                  placeholder="Ask about your business…"
                  rows={1}
                  maxLength={4000}
                  disabled={busy}
                  aria-label="Message"
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
                />
                {busy ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => void chat.stop()}
                    aria-label="Stop"
                  >
                    <Square className="size-4" aria-hidden />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    disabled={(!input.trim() && !attachment.ready) || attachment.uploading}
                    aria-label="Send"
                  >
                    <Send className="size-4" aria-hidden />
                  </Button>
                )}
              </form>
              {/* The write-tools switch sits with the input, so the header stays one row at
                any width. A narrow card (a phone) gets the short form of the note. */}
              <div className="mt-2 flex items-center gap-3 @lg:items-start">
                <WriteToolsSwitch
                  conversationId={activeId}
                  enabled={writeEnabled}
                  onEnabledChange={changeWriteEnabled}
                  disabled={busy}
                  className="shrink-0"
                />
                <p className="min-w-0 text-xs leading-4 text-muted-foreground @lg:pt-0.5 @lg:leading-5">
                  <span className="@lg:hidden">
                    {writeEnabled
                      ? "Each change waits for your approval."
                      : "Verify figures in the source module."}
                  </span>
                  <span className="hidden @lg:inline">
                    {writeEnabled
                      ? "Write tools are on: the assistant can propose creating, changing, sending and deleting records in this conversation. Nothing changes until you approve it, and everything it does is recorded in the audit log. "
                      : "The assistant can look things up and prepare unsaved drafts, but cannot change your records in this conversation. "}
                    Verify important figures in the relevant module.
                  </span>
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Conversation list. On a wide screen it stays beside a long conversation. */}
        <section
          id="conversations"
          aria-labelledby="assistant-conversations"
          className="scroll-mt-20 max-lg:mt-6 lg:sticky lg:top-22 lg:col-start-1 lg:row-start-2"
        >
          {initialConversations.length === 0 ? (
            <>
              <h2 id="assistant-conversations" className="mb-3 text-base font-semibold">
                Conversations
              </h2>
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">No conversations yet.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ask {brand.assistantName} something and the conversation is kept here.
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xs lg:max-h-[calc(100dvh-12rem)]">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                <h2 id="assistant-conversations">Conversations</h2>
                <span className="font-mono tabular-nums">
                  {rows.length}
                  {list.hasMore ? "+" : ""}
                </span>
              </div>
              <div className="relative shrink-0 border-b border-border p-2">
                <Search
                  className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  type="search"
                  value={list.query}
                  onChange={(event) => list.setQuery(event.target.value)}
                  placeholder="Search conversations"
                  aria-label="Search conversations"
                  maxLength={80}
                  className="pl-9"
                />
              </div>
              {list.failed ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-muted-foreground" role="alert">
                    Your conversations could not be loaded.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={list.retry}
                  >
                    Try again
                  </Button>
                </div>
              ) : list.loading ? (
                <div
                  className="divide-y divide-border"
                  role="status"
                  aria-label="Loading conversations"
                >
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="space-y-2 px-4 py-3">
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <div className="p-6 text-center">
                  {list.term ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        No conversations match &ldquo;{list.term}&rdquo;.
                      </p>
                      <button
                        type="button"
                        onClick={() => list.setQuery("")}
                        className="mt-1 cursor-pointer text-sm text-brand-blue hover:underline"
                      >
                        Clear search
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No conversations yet.</p>
                  )}
                </div>
              ) : (
                <nav ref={listRef} aria-label="Conversations" className="min-h-0 overflow-y-auto">
                  <ul className="divide-y divide-border">
                    {rows.map((c) => {
                      const isActive = c.id === activeId;
                      const label = isActive && displayTitle ? displayTitle : c.title;
                      return (
                        <li
                          key={c.id as string}
                          className={cn(
                            "flex items-center gap-1 pr-2 transition-colors",
                            isActive
                              ? "bg-brand-blue/5 dark:bg-brand-blue/10"
                              : "hover:bg-muted/30",
                          )}
                        >
                          <Link
                            href={`/assistant?c=${c.id}`}
                            aria-current={isActive ? "page" : undefined}
                            className="min-w-0 flex-1 py-3 pl-4 outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
                          >
                            <span className="block truncate text-sm font-medium">{label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {isActive ? "Open now · " : ""}
                              <time dateTime={c.updatedAt.toISOString()} suppressHydrationWarning>
                                {formatRelativeTime(c.updatedAt)}
                              </time>
                            </span>
                          </Link>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete({ id: c.id as string, title: label })}
                            aria-label={`Delete conversation ${label}`}
                            className="shrink-0 text-muted-foreground hover:text-destructive max-md:min-h-11"
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                  {list.hasMore ? (
                    <div className="border-t border-border p-3 text-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          focusRowAfterMore.current = rows.length;
                          void list.showMore();
                        }}
                        disabled={list.loadingMore}
                      >
                        {list.loadingMore ? "Loading…" : "Show more"}
                      </Button>
                      {list.moreFailed ? (
                        <p className="mt-2 text-xs text-destructive" role="alert">
                          Older conversations could not be loaded. Try again.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </nav>
              )}
            </div>
          )}
        </section>
      </div>

      <DeleteConversationDialog
        conversation={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onDeleted={onDeleted}
      />

      <Dialog
        open={renameDraft !== null}
        onOpenChange={(open) => {
          if (!open && !renaming) setRenameDraft(null);
        }}
      >
        <DialogContent>
          <form onSubmit={(e) => void onRename(e)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Rename conversation</DialogTitle>
              <DialogDescription>Only you see this name.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="conversation-title">Name</Label>
              <Input
                id="conversation-title"
                value={renameDraft ?? ""}
                onChange={(e) => setRenameDraft(e.target.value)}
                maxLength={80}
                autoFocus
                aria-invalid={renameError ? true : undefined}
                aria-describedby={renameError ? "conversation-title-error" : undefined}
              />
              {renameError ? (
                <p id="conversation-title-error" className="text-sm text-destructive" role="alert">
                  {renameError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameDraft(null)}
                disabled={renaming}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renaming || !renameDraft?.trim()}>
                {renaming ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
