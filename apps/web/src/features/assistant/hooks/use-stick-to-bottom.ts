"use client";

import { useCallback, useEffect, useRef } from "react";

/** How close to the end still counts as "reading the latest message". */
const NEAR_END_PX = 80;

/**
 * Keeps a scrolling message list on its newest content while a reply streams in, unless
 * the person has scrolled up to read something earlier. Sending a message (`follow()`)
 * or showing the list again (`viewKey` changes) goes back to following.
 *
 * Give `attach` to the scrolling element as its `ref` and `onScroll` as its scroll handler.
 * The element is watched for changes rather than a messages value, because the list also
 * grows without a new message (an error with "Try again", the note under a thumbs down)
 * and can be mounted after this hook's effects have run (the side panel's dialog).
 */
export function useStickToBottom<T extends HTMLElement>(viewKey?: unknown) {
  const node = useRef<T | null>(null);
  const following = useRef(true);
  const observer = useRef<MutationObserver | null>(null);

  const toEnd = useCallback(() => {
    const element = node.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, []);

  // Shown again (the panel reopened, or back from History): read from the newest message.
  useEffect(() => {
    following.current = true;
    toEnd();
  }, [viewKey, toEnd]);

  const attach = useCallback(
    (element: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      node.current = element;
      if (!element) return;
      toEnd();
      if (typeof MutationObserver === "undefined") return;
      observer.current = new MutationObserver(toEnd);
      observer.current.observe(element, { childList: true, subtree: true, characterData: true });
    },
    [toEnd],
  );
  const onScroll = useCallback(() => {
    const element = node.current;
    if (!element) return;
    following.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_END_PX;
  }, []);
  const follow = useCallback(() => {
    following.current = true;
  }, []);

  return { attach, onScroll, follow };
}
