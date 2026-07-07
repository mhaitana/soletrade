"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, Plus, Send, Square, Trash2, Zap } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { cn } from "@/shared/lib/utils";
import { deleteConversationAction, setWriteEnabledAction, type AssistantPageData } from "./actions";

/**
 * AI assistant chat client (Phase 10). Uses the AI SDK v5 `useChat` hook with a
 * `DefaultChatTransport` pointed at `POST /api/assistant`. The transport is customized:
 *
 * - `prepareSendMessagesRequest` sends only `{ conversationId, message }` (the route
 *   reconstructs full history from the persisted conversation — the client doesn't send
 *   the whole transcript).
 * - `fetch` intercepts the response to capture the `X-Conversation-Id` header (set by
 *   the route when it creates a new conversation on the first send) and updates the URL
 *   via `history.replaceState` (no Next.js navigation → no remount → the in-flight stream
 *   is preserved). The sidebar is refreshed on `onFinish`.
 *
 * Messages render from `message.parts` (text only this phase — tool calls are server-
 * side and opaque to the client). Plain text + `whitespace-pre-wrap`; no markdown.
 */
const SUGGESTED_PROMPTS = [
  "How's my business doing this month?",
  "List my overdue invoices",
  "What's my cash position?",
  "Who are my recent customers?",
];

function messageText(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

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
  const [conversationId, setConversationId] = useState<string | null>(initialId);
  const [input, setInput] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  // Write-tools opt-in (Phase 11d). Seeded from the server-loaded conversation; the
  // hard boundary is the `write_enabled` DB flag, toggled via `setWriteEnabledAction`.
  const [writeEnabled, setWriteEnabled] = useState<boolean>(
    activeConversation?.writeEnabled ?? false,
  );
  const [writeToggling, setWriteToggling] = useState(false);

  // Initial messages from the server-loaded conversation. `useState` lazy init runs once
  // (the component remounts via `key={c}` when switching conversations, re-running this).
  const [initialMessages] = useState<UIMessage[]>(
    () =>
      (activeConversation?.messages ?? []).map((m, i) => ({
        id: `init-${i}`,
        role: m.role,
        parts: [{ type: "text", text: m.content }],
      })) as UIMessage[],
  );

  // The transport is created once (useState lazy init). It only sends the standard
  // `{ messages }` body — `conversationId` is added per-send via `sendMessage`'s `body`
  // option (so the latest id is used without recreating the transport). The `fetch`
  // wrapper captures the `X-Conversation-Id` response header the route sets when it
  // creates a new conversation, updates the URL via `history.replaceState` (no Next.js
  // navigation → no remount → the in-flight stream is preserved), and stashes the id in
  // state for subsequent sends. `setConversationId` is stable, so the closure is safe.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/assistant",
        fetch: async (url, init) => {
          const res = await globalThis.fetch(url, init);
          const id = res.headers.get("X-Conversation-Id");
          if (id) {
            setConversationId((prev) => prev ?? id);
            window.history.replaceState(null, "", `/assistant?c=${id}`);
          }
          return res;
        },
      }),
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: initialId ?? "assistant-new",
    messages: initialMessages,
    transport,
    onFinish: () => {
      router.refresh();
    },
  });

  const busy = status === "submitted" || status === "streaming";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text }, { body: { conversationId } });
  }

  async function onDelete(id: string) {
    setPendingDelete(id);
    const res = await deleteConversationAction({ conversationId: id });
    setPendingDelete(null);
    if (!res.ok) return;
    if (id === conversationId || id === initialId) {
      router.push("/assistant");
    } else {
      router.refresh();
    }
  }

  async function toggleWrite(next: boolean): Promise<void> {
    // Write-tools need a persisted conversation (created on first send). Before that,
    // the toggle is disabled in the UI; this guard is defense-in-depth.
    const id = conversationId ?? initialId;
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

  const activeId = conversationId ?? initialId;
  const hasMessages = messages.length > 0;
  const canToggleWrite = Boolean(activeId); // needs a persisted conversation

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
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
                    {c.title}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void onDelete(c.id as string)}
                    disabled={pendingDelete === (c.id as string)}
                    aria-label={`Delete conversation ${c.title}`}
                    className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
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
            <Bot className="size-5 text-primary" aria-hidden />
            <h1 className="text-sm font-semibold">soletrade labs assistant</h1>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={writeEnabled}
                disabled={!canToggleWrite || writeToggling || busy}
                onClick={() => void toggleWrite(!writeEnabled)}
                title={
                  canToggleWrite
                    ? writeEnabled
                      ? "Write tools on — assistant will ask before creating anything"
                      : "Allow the assistant to create customers, invoices, quotes, transactions"
                    : "Send a message first to enable write tools"
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  writeEnabled
                    ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "border-border text-muted-foreground hover:bg-muted/40",
                )}
              >
                <Zap className="size-3.5" aria-hidden />
                <span>{writeEnabled ? "Write tools on" : "Write tools off"}</span>
              </button>
            </div>
          </header>

          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {!hasMessages ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <Bot className="size-10 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-sm font-medium">Ask about your business</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The assistant reads real workspace data — invoices, books, customers.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTED_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => void sendMessage({ text: p }, { body: { conversationId } })}
                      disabled={busy}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => {
                const text = messageText(m);
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                        isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                      )}
                    >
                      {text || (m.role === "assistant" && busy ? "…" : "")}
                    </div>
                  </div>
                );
              })
            )}
            {error ? (
              <p className="text-center text-xs text-rose-600" role="alert">
                {error.message || "Something went wrong. Please try again."}
              </p>
            ) : null}
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
              placeholder="Ask anything about your workspace…"
              rows={1}
              disabled={busy}
              aria-label="Message"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary disabled:opacity-50"
            />
            {busy ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => stop()}
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
          The assistant uses read-only access to your workspace data. Verify important figures in
          the relevant module.{" "}
          {writeEnabled
            ? "Write tools are on — the assistant will ask for confirmation before creating anything. "
            : ""}
          {activeConversation ? `Started ${formatDate(activeConversation.updatedAt)}.` : ""}
        </p>
      </section>
    </div>
  );
}
