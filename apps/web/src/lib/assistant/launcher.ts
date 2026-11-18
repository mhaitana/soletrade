/**
 * Opening hAI from anywhere in the app. The command palette, the dashboard and record
 * pages live in other features and may not import the assistant feature, so they ask
 * through this browser event and the app shell (which owns the panel) answers it.
 */
export interface HaiAsk {
  /** A question to put to hAI. Without one the panel just opens. */
  question?: string;
  /** Send the question straight away, as a new conversation, instead of leaving it in the input. */
  send?: boolean;
}

const EVENT_NAME = "hai:ask";

/** Open the hAI panel, optionally with a question. */
export function askHai(ask: HaiAsk = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<HaiAsk>(EVENT_NAME, { detail: ask }));
}

/** Listen for `askHai` calls. Returns the function that stops listening. */
export function onHaiAsk(handler: (ask: HaiAsk) => void): () => void {
  function listener(event: Event) {
    handler((event as CustomEvent<HaiAsk>).detail ?? {});
  }
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
