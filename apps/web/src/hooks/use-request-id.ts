"use client";

import { useCallback, useState } from "react";

/**
 * A random version 4 UUID. `crypto.randomUUID` exists only on secure pages (https or
 * localhost); a dev server opened from a phone over the local network is plain http, so
 * fall back to `getRandomValues`, which is available everywhere.
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One id for the draft a create form is editing. Every save attempt sends the same id, so
 * the server can tell a retry (after a lost response) from a new record and never creates
 * the record twice. Call `renew` once a save succeeds and the form may start a new draft.
 */
export function useRequestId(): { requestId: string; renew: () => void } {
  const [requestId, setRequestId] = useState(newRequestId);
  const renew = useCallback(() => setRequestId(newRequestId()), []);
  return { requestId, renew };
}
