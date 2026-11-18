"use client";

import { useEffect, useRef } from "react";

/**
 * What one hAI surface tells the other. The side panel and the assistant page can be on
 * screen together (the panel opens over, or beside, the page) and each keeps its own copy
 * of a conversation, so without this a reply, a delete or the write-tools switch in one
 * left the other showing stale state until a reload.
 */
export type HaiSurface = "panel" | "page";

export type HaiEvent =
  /** A turn finished: the conversation has new messages (or was just created). */
  | { type: "conversation-updated"; id: string }
  | { type: "conversation-deleted"; id: string }
  | { type: "write-tools-changed"; id: string; enabled: boolean };

const EVENT_NAME = "hai:event";

type Envelope = { source: HaiSurface; event: HaiEvent };

/** Tell the other surface what just happened here. */
export function publishHaiEvent(source: HaiSurface, event: HaiEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Envelope>(EVENT_NAME, { detail: { source, event } }));
}

/** Hear what the other surface did. Events this surface published itself are skipped. */
export function useHaiEvents(surface: HaiSurface, handler: (event: HaiEvent) => void): void {
  // The handler reads current state, so the listener always calls the latest one.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    function onEvent(raw: Event) {
      const detail = (raw as CustomEvent<Envelope>).detail;
      if (detail && detail.source !== surface) latest.current(detail.event);
    }
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, [surface]);
}
