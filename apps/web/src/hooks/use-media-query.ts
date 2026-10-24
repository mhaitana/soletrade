"use client";

import { useState, useSyncExternalStore } from "react";

function subscribe(callback: () => void, query: string): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(query: string): boolean {
  return window.matchMedia(query).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => subscribe(callback, query),
    () => getSnapshot(query),
    () => getServerSnapshot(),
  );
}

/**
 * Mobile breakpoint used by ResponsiveDialog. Returns `false` during SSR/hydration
 * to avoid hydration mismatches, then updates to the real viewport value after
 * mount.
 */
export function useIsMobile(): boolean {
  const [mounted, setMounted] = useState(false);
  const matches = useMediaQuery("(max-width: 767px)");

  // Defer the "mounted" flag to the first client render instead of using an
  // effect. This avoids the react-hooks/set-state-in-effect lint rule while still
  // returning `false` during SSR/hydration to prevent layout mismatches.
  if (typeof window !== "undefined" && !mounted) {
    setMounted(true);
  }

  return mounted && matches;
}
