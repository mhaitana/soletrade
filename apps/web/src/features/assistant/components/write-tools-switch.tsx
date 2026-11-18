"use client";

import { useEffect, useRef, useState } from "react";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { setWriteEnabledAction } from "@/features/assistant/api/actions";

/**
 * The per-conversation switch that lets hAI propose changes. The assistant page and the
 * side panel both use it, so turning write tools on asks the same question in either
 * place. The hard boundary is the conversation's `write_enabled` flag on the server; this
 * only shows and changes it.
 */
export function WriteToolsSwitch({
  conversationId,
  enabled,
  onEnabledChange,
  disabled,
  className,
}: {
  /** Null until the first message has created the conversation. */
  conversationId: string | null;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** A reply is in flight. */
  disabled?: boolean;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // What the switch is showing now. A request that fails after the person has moved to
  // another conversation must not flip that conversation's switch.
  const latest = useRef({ conversationId, onEnabledChange });
  useEffect(() => {
    latest.current = { conversationId, onEnabledChange };
  });

  async function change(next: boolean): Promise<void> {
    const id = conversationId;
    if (!id) return;
    setSaving(true);
    onEnabledChange(next); // Shown at once; put back if the server did not take it.
    const putBack = () => {
      if (latest.current.conversationId === id) latest.current.onEnabledChange(!next);
    };
    try {
      const result = await setWriteEnabledAction({ conversationId: id, enabled: next });
      if (!result.ok) putBack();
    } catch {
      putBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={!conversationId || saving || disabled}
        onClick={() => {
          // Turning write tools on is a deliberate step, so it asks first; turning them
          // off never needs a second thought.
          if (enabled) void change(false);
          else setConfirming(true);
        }}
        title={
          conversationId
            ? enabled
              ? "Write tools on - every change waits for your approval"
              : "Allow the assistant to propose changes in this conversation"
            : "Send a message first to enable write tools"
        }
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-10 max-md:px-3 max-md:py-2 max-md:text-sm",
          enabled
            ? "border-warning/20 bg-warning/10 text-foreground"
            : "border-border bg-muted text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <Zap className={cn("size-3.5", enabled && "text-warning")} aria-hidden />
        <span>{enabled ? "Write tools on" : "Write tools off"}</span>
      </button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            // The dialog has no trigger element of its own to return to.
            event.preventDefault();
            buttonRef.current?.focus();
          }}
        >
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
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                void change(true);
              }}
            >
              Turn on
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
