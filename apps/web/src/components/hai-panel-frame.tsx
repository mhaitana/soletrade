"use client";

import type { ReactNode, RefObject } from "react";
import { Dialog } from "radix-ui";
import { brand } from "@/config/brand";
import { useMediaQuery } from "@/hooks/use-media-query";

/** Shared by the lazy loading state and the assistant, whose state lives above this frame. */
export function HaiPanelFrame({
  open,
  onOpenChange,
  returnFocusRef,
  initialFocusRef,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  initialFocusRef?: RefObject<HTMLTextAreaElement | null>;
  children: ReactNode;
}) {
  // The sidebar and dock together use 640px. Keep the workspace wide enough
  // for its dashboard and top-bar controls before enabling side-by-side work.
  const desktop = useMediaQuery("(min-width: 1536px)");

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={!desktop}>
      <Dialog.Portal>
        {!desktop ? (
          <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[1px]" />
        ) : null}
        <Dialog.Content
          id="hai-assistant-panel"
          aria-modal={!desktop ? true : undefined}
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(100%,26rem)] flex-col border-l border-border bg-background shadow-lg outline-none 2xl:z-30 2xl:w-96 2xl:shadow-none"
          onOpenAutoFocus={(event) => {
            if (initialFocusRef?.current && !initialFocusRef.current.disabled) {
              event.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Loading-to-chat and breakpoint changes also unmount content. Only
            // an actual close should move focus back to the top bar.
            if (!open) returnFocusRef.current?.focus();
          }}
          onInteractOutside={(event) => {
            // The wide-screen assistant stays beside the user's current work.
            if (desktop) event.preventDefault();
          }}
        >
          <Dialog.Title className="sr-only">{brand.assistantName} global assistant</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
