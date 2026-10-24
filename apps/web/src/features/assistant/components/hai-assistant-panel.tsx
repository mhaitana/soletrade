"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  ArrowUpRight,
  Bot,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HaiPanelFrame } from "@/components/hai-panel-frame";
import {
  HaiToolPart,
  useHaiToolNavigation,
} from "@/features/assistant/hooks/use-hai-tool-navigation";

const STARTERS = [
  "What should I pay attention to here?",
  "How is my business doing this month?",
  "Draft an invoice for a customer",
];

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function HaiAssistantPanel({
  open,
  onOpenChange,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: "/api/assistant",
        fetch: async (url, init) => {
          const response = await globalThis.fetch(url, init);
          const id = response.headers.get("X-Conversation-Id");
          if (id) setConversationId((current) => current ?? id);
          return response;
        },
      }),
  );

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    id: "hai-global-assistant",
    transport,
  });
  useHaiToolNavigation(messages);

  const busy = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, open]);

  function contextBody() {
    return {
      conversationId,
      pageContext: {
        pathname,
        search: typeof window === "undefined" ? "" : window.location.search,
      },
    };
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed }, { body: contextBody() });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(input);
  }

  function newConversation() {
    if (busy) stop();
    setMessages([]);
    setConversationId(null);
    setInput("");
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
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
            <div className="space-y-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => send(starter)}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <span>{starter}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              ))}
            </div>
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
            {messages.map((message) => {
              const user = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={cn("flex", user ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[92%] space-y-2 text-sm",
                      user &&
                        "whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-primary-foreground",
                    )}
                  >
                    {user
                      ? messageText(message)
                      : message.parts.map((part, index) => {
                          if (part.type === "text" && part.text) {
                            return (
                              <div
                                key={`${message.id}-text-${index}`}
                                className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 leading-6 text-foreground"
                              >
                                {part.text}
                              </div>
                            );
                          }
                          if (isToolUIPart(part)) {
                            return <HaiToolPart key={part.toolCallId} part={part} />;
                          }
                          return null;
                        })}
                  </div>
                </div>
              );
            })}
            {busy && messages.at(-1)?.role === "user" ? (
              <div className="flex justify-start">
                <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {brand.assistantName} is checking your workspace…
                </div>
              </div>
            ) : null}
            {error ? (
              <p
                className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive"
                role="alert"
              >
                {error.message || `${brand.assistantName} couldn't complete that request.`}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send(input);
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
              onClick={stop}
              aria-label="Stop response"
            >
              <Square className="size-4" aria-hidden />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              className="size-11 xl:size-9"
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <Send className="size-4" aria-hidden />
            </Button>
          )}
        </form>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[0.7rem] text-muted-foreground">
          <span>Verify figures in the source module.</span>
          <Link
            href={conversationId ? `/assistant?c=${conversationId}` : "/assistant"}
            onClick={() => onOpenChange(false)}
            className="shrink-0 font-medium text-brand-blue hover:underline"
          >
            History
          </Link>
        </div>
      </div>
    </HaiPanelFrame>
  );
}
