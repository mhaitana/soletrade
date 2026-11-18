import "server-only";
import { after } from "next/server";

/**
 * Work that should not hold up the response: Next.js `after` runs it once the response has
 * been sent. `after` only works while a request is being handled and throws anywhere else
 * (unit tests, scripts, server start-up), so both helpers fall back cleanly.
 */

/** Queue `task` to run after the response. Returns false when there is no request to outlive. */
export function scheduleAfterResponse(task: () => Promise<void>): boolean {
  try {
    after(task);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a best-effort side effect after the response when possible, otherwise right away.
 * A failure is logged under `label` and never reaches the caller: by definition nothing
 * in the response depends on this work.
 */
export async function runAfterResponse(label: string, task: () => Promise<unknown>): Promise<void> {
  const guarded = async () => {
    try {
      await task();
    } catch (err) {
      console.error(`${label} failed:`, err);
    }
  };
  if (!scheduleAfterResponse(guarded)) await guarded();
}
