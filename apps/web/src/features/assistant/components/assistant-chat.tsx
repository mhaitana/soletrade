"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Bot, Pencil, Plus, Send, Square, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { storedToUIMessage, type HaiUIMessage } from "@/lib/assistant/messages";
import {
  renameConversationAction,
  setWriteEnabledAction,
  type AssistantPageData,
} from "@/features/assistant/api/actions";
import {
  toolCallIdsOf,
  useHaiToolNavigation,
} from "@/features/assistant/hooks/use-hai-tool-navigation";
import { useHaiChat } from "@/features/assistant/hooks/use-hai-chat";
import { DeleteConversationDialog } from "@/features/assistant/components/delete-conversation-dialog";
import { HaiChatError, HaiMessage } from "@/features/assistant/components/hai-message";

/**
 * The assistant page chat. The conversation is stored on the server (whole messages,
 * including tool calls and their approval state), so reopening it shows exactly what
 * happened, and changes still waiting for approval can be approved after a reload.
 *
 * The first message creates the conversation; the route returns its id in
 * `X-Conversation-Id`, and the URL is updated with `history.replaceState` so the stream
 * in flight is not interrupted. The sidebar refreshes when each reply finishes.
 */
const SUGGESTED_PROMPTS = [
  "How's my business doing this month?",
  "List my overdue invoices",
  "What's my cash position?",
  "Who are my recent customers?",
];

function formatDate(d: Date): string {
  return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function AssistantChat({
  initialConversations,
  activeConversation,
}: {
  initialConversations: AssistantPageData["conversations"];
  activeConversation: AssistantPageData["activeConversation"];
}) {
  const router = useRouter();
  const initialId = activeConversation?.id ?? null;
  const [input, setInput] = useState("");
  // Deleting a conversation and switching write tools on both ask first.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState<string | null>(activeConversation?.title ?? null);
  // Write-tools opt-in (Phase 11d). Seeded from the server-loaded conversation; the
  // hard boundary is the `write_enabled` DB flag, toggled via `setWriteEnabledAction`.
  const [writeEnabled, setWriteEnabled] = useState<boolean>(
    activeConversation?.writeEnabled ?? false,
  );
  const [writeToggling, setWriteToggling] = useState(false);

  // Stored messages, whole. `useState` lazy init runs once; the page remounts this
  // component (`key={c}`) when switching conversations.
  const [initialMessages] = useState<HaiUIMessage[]>(() =>
    (activeConversation?.messages ?? []).map(storedToUIMessage),
  );
  // Tool calls that already ran before this page load must not navigate again.
  const [settled] = useState(() => toolCallIdsOf(initialMessages));

  const chat = useHaiChat({
    chatId: initialId ?? "assistant-new",
    conversationId: initialId,
    initialMessages,
    onConversationCreated: (id) => window.history.replaceState(null, "", `/assistant?c=${id}`),
    onFinish: () => router.refresh(),
  });
  const { messages, busy, error, conversationId } = chat;
  useHaiToolNavigation(messages, settled);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    chat.send(input);
    setInput("");
  }

  function onDeleted(id: string) {
    setConfirmDelete(null);
    if (id === conversationId || id === initialId) {
      router.push("/assistant");
    } else {
      router.refresh();
    }
  }

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
      setTitle(result.title);
      setRenameDraft(null);
      router.refresh();
    } catch {
      setRenameError("The conversation could not be renamed. Please try again.");
    } finally {
      setRenaming(false);
    }
  }

  async function toggleWrite(next: boolean): Promise<void> {
    // Write-tools need a persisted conversation (created on first send). Before that,
    // the toggle is disabled in the UI; this guard is defense-in-depth.
    const id = conversationId;
    if (!id) return;
    setWriteToggling(true);
    setWriteEnabled(next); // optimistic
    try {
      const res = await setWriteEnabledAction({ conversationId: id, enabled: next });
      if (!res.ok) setWriteEnabled(!next); // roll back on failure
    } catch {
      setWriteEnabled(!next);
    } finally {
      setWriteToggling(false);
    }
  }

  const activeId = conversationId;
  const hasMessages = messages.length > 0;
  const canToggleWrite = Boolean(activeId); // needs a persisted conversation
  const displayTitle = title ?? initialConversations.find((c) => c.id === activeId)?.title ?? null;

  return (
    // One column that cannot grow past the screen: a long conversation title is cut short
    // instead of pushing the page wider than a phone.
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Sidebar: conversation list */}
      <aside className="order-2 lg:order-1">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Conversations</h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/assistant">
              <Plus className="size-4" aria-hidden />
              New
            </Link>
          </Button>
        </div>
        <nav className="space-y-1" aria-label="Conversations">
          {initialConversations.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">No conversations yet.</p>
          ) : (
            initialConversations.map((c) => {
              const isActive = c.id === activeId;
              const label = isActive && displayTitle ? displayTitle : c.title;
              return (
                <div
                  key={c.id as string}
                  className={cn(
                    "group flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-transparent hover:border-border hover:bg-muted/40",
                  )}
                >
                  <Link
                    href={`/assistant?c=${c.id}`}
                    className="flex-1 truncate"
                    aria-current={isActive ? "page" : undefined}
                  >
                    {label}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete({ id: c.id as string, title: label })}
                    aria-label={`Delete conversation ${label}`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 max-lg:size-11 max-lg:p-0 max-lg:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              );
            })
          )}
        </nav>
      </aside>

      {/* Chat panel */}
      <section className="order-1 flex min-h-[60vh] flex-col lg:order-2">
        <Card className="flex min-h-[60vh] flex-1 flex-col">
          <header className="flex items-center gap-2 border-b px-4 py-3">
            <Bot className="size-5 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-semibold">{brand.assistantName} assistant</h1>
              {activeId && displayTitle ? (
                <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{displayTitle}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRenameError("");
                      setRenameDraft(displayTitle);
                    }}
                    disabled={busy}
                    aria-label="Rename conversation"
                    title="Rename conversation"
                    className="grid shrink-0 place-items-center rounded p-1 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 max-md:size-11"
                  >
                    <Pencil className="size-3" aria-hidden />
                  </button>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={writeEnabled}
                disabled={!canToggleWrite || writeToggling || busy}
                onClick={() => {
                  // Turning write tools on is a deliberate step, so it asks first; turning
                  // them off never needs a second thought.
                  if (writeEnabled) void toggleWrite(false);
                  else setConfirmWrite(true);
                }}
                title={
                  canToggleWrite
                    ? writeEnabled
                      ? "Write tools on - every change waits for your approval"
                      : "Allow the assistant to propose changes in this conversation"
                    : "Send a message first to enable write tools"
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-10 max-md:px-3 max-md:py-2 max-md:text-sm",
                  writeEnabled
                    ? "border-warning/50 bg-warning/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/40",
                )}
              >
                <Zap className={cn("size-3.5", writeEnabled && "text-warning")} aria-hidden />
                <span>{writeEnabled ? "Write tools on" : "Write tools off"}</span>
              </button>
            </div>
          </header>

          {/* Messages. Only the status line is announced, not every streamed token. */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {!hasMessages ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <Bot className="size-10 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">Ask about your business</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The assistant reads real workspace data - invoices, books, customers.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => chat.send(p)}
                      disabled={busy}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50 max-md:min-h-11 max-md:px-4 max-md:py-2 max-md:text-sm"
                    >
                      {p}
                    </button>
                  ))}
                </div>
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
            <p className="sr-only" aria-live="polite">
              {busy ? `${brand.assistantName} is answering…` : ""}
            </p>
          </div>

          {/* Input */}
          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSubmit(e as unknown as FormEvent);
                }
              }}
              placeholder={`Ask ${brand.assistantName} about this page or your business…`}
              rows={1}
              maxLength={4000}
              disabled={busy}
              aria-label="Message"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary disabled:opacity-50"
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
              <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                <Send className="size-4" aria-hidden />
              </Button>
            )}
          </form>
        </Card>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {writeEnabled
            ? "Write tools are on: the assistant can propose creating, changing, sending and deleting records in this conversation. Nothing changes until you approve it, and everything it does is recorded in the audit log. "
            : "The assistant can look things up and prepare unsaved drafts, but cannot change your records in this conversation. "}
          Verify important figures in the relevant module.{" "}
          {activeConversation ? (
            <>
              Last active{" "}
              <time dateTime={activeConversation.updatedAt.toISOString()} suppressHydrationWarning>
                {formatDate(activeConversation.updatedAt)}
              </time>
              .
            </>
          ) : (
            ""
          )}
        </p>
      </section>

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

      <Dialog open={confirmWrite} onOpenChange={setConfirmWrite}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn on write tools for this conversation?</DialogTitle>
            <DialogDescription>
              The assistant will be able to propose creating, changing, sending, marking paid,
              voiding and deleting records here, including emailing an invoice to a customer. Each
              change is shown to you first with what it will do, and nothing is saved, sent or
              deleted until you approve it. Every action is recorded in the audit log. You can
              switch this off at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmWrite(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmWrite(false);
                void toggleWrite(true);
              }}
            >
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
