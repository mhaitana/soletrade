"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Bot, MessageSquarePlus, Send, ShieldCheck, Sparkles, Square, X } from "lucide-react";
import { brand } from "@/config/brand";
import type { HaiAsk } from "@/lib/assistant/launcher";
import { withAttachment } from "@/lib/assistant/attachments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HaiPanelFrame } from "@/components/hai-panel-frame";
import { useHaiToolNavigation } from "@/features/assistant/hooks/use-hai-tool-navigation";
import {
  loadConversation,
  type LoadedConversation,
} from "@/features/assistant/hooks/load-conversation";
import { useHaiChat } from "@/features/assistant/hooks/use-hai-chat";
import { useMessageFeedback } from "@/features/assistant/hooks/use-message-feedback";
import { useReceiptAttachment } from "@/features/assistant/hooks/use-receipt-attachment";
import { publishHaiEvent, useHaiEvents } from "@/features/assistant/hooks/use-hai-events";
import { useStickToBottom } from "@/features/assistant/hooks/use-stick-to-bottom";
import { HaiChatError, HaiMessage } from "@/features/assistant/components/hai-message";
import { HaiPanelHistory } from "@/features/assistant/components/hai-panel-history";
import { HaiStarters } from "@/features/assistant/components/hai-starters";
import {
  AttachReceiptButton,
  AttachmentStatus,
} from "@/features/assistant/components/receipt-attachment";
import { WriteToolsSwitch } from "@/features/assistant/components/write-tools-switch";

const STARTERS = [
  "What should I pay attention to here?",
  "How is my business doing this month?",
  "Draft an invoice for a customer",
];

/** The panel's conversation for this browser tab, so a reload keeps the thread. */
const STORAGE_KEY = "hai-panel-conversation";

function readStoredConversation(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeConversation(id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(STORAGE_KEY, id);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the thread then
    // simply does not survive a reload.
  }
}

const NO_CALLS: ReadonlySet<string> = new Set();

export function HaiAssistantPanel({
  open,
  onOpenChange,
  returnFocusRef,
  ask = null,
  canAttachReceipts = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  /** A question put to hAI from elsewhere in the app; a new `id` is a new request. */
  ask?: (HaiAsk & { id: number }) | null;
  /** Books is installed and this person may add receipts, so the input offers to attach one. */
  canAttachReceipts?: boolean;
}) {
  const pathname = usePathname();
  const [input, setInput] = useState("");
  // History is a view of this panel, not another page: a past conversation opens here.
  const [view, setView] = useState<"chat" | "history">("chat");
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    // Reopening the panel always starts on the chat.
    if (!open) setView("chat");
  }
  // Tool calls from a restored thread already ran; they must not navigate again.
  const [settled, setSettled] = useState<ReadonlySet<string>>(NO_CALLS);
  // Whether hAI may propose changes in the conversation on screen.
  const [writeEnabled, setWriteEnabled] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const attachButtonRef = useRef<HTMLButtonElement>(null);
  // Counts what the person has chosen to look at. A stored conversation that finishes
  // loading after they moved on (sent a message, started a new chat, picked another one,
  // went back) belongs to an earlier choice and must not replace what is on screen.
  const choice = useRef(0);
  const leftHistoryRef = useRef(false);

  const chat = useHaiChat({
    surface: "panel",
    chatId: "hai-global-assistant",
    conversationId: null,
    onConversationCreated: storeConversation,
  });
  const { messages, busy, error, conversationId, restore } = chat;
  useHaiToolNavigation(messages, settled);
  const hasMessages = messages.length > 0;

  // Opening the panel, or coming back from History, shows the newest message again.
  const {
    attach: attachThread,
    onScroll: onThreadScroll,
    follow: followThread,
  } = useStickToBottom<HTMLDivElement>(`${open}:${view}`);

  // A question from elsewhere in the app (see `askHai`). One that is to be sent starts a
  // new conversation, so it never lands in the middle of an unrelated one; while a reply
  // is still arriving it waits in the input instead.
  const askedQuestion = ask?.question?.trim() ?? "";
  const sendAsked = Boolean(ask?.send && askedQuestion && !busy);
  const [seenAsk, setSeenAsk] = useState(0);
  // The last question sent from an ask, so pressing the same button again while its reply
  // is still arriving does not also leave a copy of the question in the input.
  const [lastSentAsk, setLastSentAsk] = useState("");
  if (ask && ask.id !== seenAsk) {
    setSeenAsk(ask.id);
    setView("chat");
    if (sendAsked) {
      // `settled` is left alone: the old messages are still on screen until the effect
      // below empties them, and clearing it here would run their navigation again.
      setWriteEnabled(false);
      setLastSentAsk(askedQuestion);
    } else if (askedQuestion && !(busy && askedQuestion === lastSentAsk)) {
      setInput(askedQuestion);
    }
  }
  const sentAsk = useRef(0);
  useEffect(() => {
    if (!ask || sentAsk.current === ask.id) return;
    sentAsk.current = ask.id;
    if (!sendAsked) return;
    choice.current += 1;
    chat.startNew();
    storeConversation(null);
    followThread();
    chat.send(askedQuestion);
    // Runs once per request; the chat's methods are recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  const feedback = useMessageFeedback();
  const attachment = useReceiptAttachment();

  /** Put a stored conversation on screen. */
  function show(conversation: LoadedConversation) {
    setSettled(conversation.settled);
    setWriteEnabled(conversation.writeEnabled);
    feedback.reset(conversation.feedback);
    restore(conversation.id, conversation.messages);
  }

  // Bring back the thread this tab was showing before a reload.
  useEffect(() => {
    const storedId = readStoredConversation();
    if (!storedId) return;
    let cancelled = false;
    const mine = choice.current;
    void (async () => {
      try {
        const conversation = await loadConversation(storedId);
        // The person did something else in the meantime; leave that alone.
        if (cancelled || choice.current !== mine) return;
        if (!conversation) {
          storeConversation(null);
          return;
        }
        show(conversation);
      } catch {
        // Start fresh; the conversation is still in History.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once when the panel first mounts; `restore` is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back from History, focus returns to the control that opened it (not the
  // composer: on a phone that would raise the keyboard over the conversation).
  useEffect(() => {
    if (view !== "chat" || !leftHistoryRef.current) return;
    leftHistoryRef.current = false;
    historyButtonRef.current?.focus();
  }, [view]);

  function send(text: string) {
    if (!text.trim() || busy) return;
    choice.current += 1;
    followThread();
    chat.send(text);
    setInput("");
  }

  /** Send what is typed, with the attached receipt if there is one. */
  function sendDraft() {
    const text = withAttachment(input, attachment.ready);
    if (!text || busy || attachment.uploading) return;
    send(text);
    attachment.clear();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    sendDraft();
  }

  /** Back to an empty chat; the next message starts a new conversation. */
  function resetConversation() {
    choice.current += 1;
    chat.startNew();
    storeConversation(null);
    setWriteEnabled(false);
    feedback.reset({});
  }

  function newConversation() {
    resetConversation();
    setInput("");
    attachment.clear();
  }

  function showChat() {
    leftHistoryRef.current = true;
    setView("chat");
  }

  /** Leave History without picking anything; a conversation still loading is dropped. */
  function backToChat() {
    choice.current += 1;
    showChat();
  }

  /**
   * Show a conversation picked from History. False when it no longer exists. If the
   * person moves on while it loads (back, a new chat, a message), nothing is shown.
   */
  async function openConversation(id: string): Promise<boolean> {
    const mine = ++choice.current;
    if (id !== conversationId) {
      const conversation = await loadConversation(id);
      if (choice.current !== mine) return true;
      if (!conversation) return false;
      show(conversation);
      storeConversation(conversation.id);
    }
    showChat();
    return true;
  }

  function onConversationDeleted(id: string) {
    if (id === conversationId) resetConversation();
    // The assistant page lists the same conversations.
    publishHaiEvent("panel", { type: "conversation-deleted", id });
  }

  function changeWriteEnabled(enabled: boolean) {
    setWriteEnabled(enabled);
    if (conversationId) {
      publishHaiEvent("panel", { type: "write-tools-changed", id: conversationId, enabled });
    }
  }

  // What the assistant page did to the conversation this panel is showing.
  useHaiEvents("panel", (event) => {
    if (event.id !== conversationId) return;
    if (event.type === "conversation-deleted") resetConversation();
    else if (event.type === "write-tools-changed") setWriteEnabled(event.enabled);
    else if (!busy) {
      const mine = choice.current;
      void loadConversation(event.id)
        .then((latest) => {
          if (latest && choice.current === mine) show(latest);
        })
        .catch(() => {
          // Keep what is on screen; reopening the conversation shows the rest.
        });
    }
  });

  if (view === "history") {
    return (
      <HaiPanelFrame open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef}>
        <HaiPanelHistory
          activeId={conversationId}
          fullPageHref={conversationId ? `/assistant?c=${conversationId}` : "/assistant"}
          onOpen={openConversation}
          onDeleted={onConversationDeleted}
          onNew={() => {
            newConversation();
            showChat();
          }}
          onBack={backToChat}
          onClose={() => {
            choice.current += 1;
            onOpenChange(false);
          }}
        />
      </HaiPanelFrame>
    );
  }

  return (
    <HaiPanelFrame
      open={open}
      onOpenChange={onOpenChange}
      returnFocusRef={returnFocusRef}
      initialFocusRef={inputRef}
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="grid size-8 place-items-center rounded-lg border border-brand-blue/25 bg-brand-blue/5 text-brand-blue">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{brand.assistantName}</h2>
          <p className="truncate text-xs text-muted-foreground">Context: {pathname}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 xl:size-9"
          onClick={newConversation}
          disabled={!hasMessages && !conversationId}
          aria-label="Start a new hAI conversation"
          title="New conversation"
        >
          <MessageSquarePlus className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 xl:size-9"
          onClick={() => onOpenChange(false)}
          aria-label={`Close ${brand.assistantName}`}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      {/* Shown once the conversation exists: the switch needs something to switch. */}
      {conversationId ? (
        <div
          className={cn(
            "flex shrink-0 items-center gap-3 border-b border-border px-4 py-2",
            writeEnabled && "bg-warning/5",
          )}
        >
          <WriteToolsSwitch
            conversationId={conversationId}
            enabled={writeEnabled}
            onEnabledChange={changeWriteEnabled}
            disabled={busy}
            className="shrink-0"
          />
          <p className="min-w-0 text-xs leading-4 text-muted-foreground">
            {writeEnabled
              ? "Each change waits for your approval."
              : `${brand.assistantName} can look things up and prepare drafts.`}
          </p>
        </div>
      ) : null}

      <div
        ref={attachThread}
        onScroll={onThreadScroll}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {!hasMessages ? (
          <div className="flex min-h-full flex-col justify-center py-6">
            <div className="mb-5">
              <Bot className="size-7 text-brand-blue" aria-hidden />
              <h3 className="mt-3 text-base font-semibold">Ask in the flow of your work</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {brand.assistantName} can use your permitted business context, open the right
                module, and prepare unsaved forms for review.
              </p>
            </div>
            <HaiStarters prompts={STARTERS} onPick={send} className="space-y-2" />
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              <span>
                Navigation and unsaved prefills are immediate. Saving, sending, or changing data
                stays under your control.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <HaiMessage
                key={message.id}
                message={message}
                busy={busy}
                isLatest={index === messages.length - 1}
                onDecide={chat.decide}
                onRegenerate={chat.regenerate}
                rating={feedback.ratings[message.id]}
                onRate={feedback.rate}
                className="max-w-[92%] leading-6"
              />
            ))}
            {busy && messages.at(-1)?.role === "user" ? (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {brand.assistantName} is checking your workspace…
                </div>
              </div>
            ) : null}
            {error ? (
              <HaiChatError
                error={error}
                fallback={`${brand.assistantName} couldn't complete that request.`}
                onRetry={chat.retry}
              />
            ) : null}
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {busy ? `${brand.assistantName} is answering…` : ""}
        </p>
      </div>

      <div className="shrink-0 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
              className="size-11 xl:size-9"
            />
          ) : null}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendDraft();
              }
            }}
            rows={1}
            maxLength={4000}
            disabled={busy}
            aria-label={`Message ${brand.assistantName}`}
            placeholder="Ask about this page or prepare a task…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
          />
          {busy ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 xl:size-9"
              onClick={() => void chat.stop()}
              aria-label="Stop response"
            >
              <Square className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-11 xl:size-9"
              disabled={(!input.trim() && !attachment.ready) || attachment.uploading}
              aria-label="Send message"
            >
              <Send className="size-4" aria-hidden />
            </Button>
          )}
        </form>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[0.7rem] text-muted-foreground">
          <span>Verify figures in the source module.</span>
          <button
            ref={historyButtonRef}
            type="button"
            onClick={() => setView("history")}
            className="-mt-2 -mr-2 -mb-3 shrink-0 cursor-pointer rounded px-2 pt-2 pb-3 font-medium text-brand-blue outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            History
          </button>
        </div>
      </div>
    </HaiPanelFrame>
  );
}
