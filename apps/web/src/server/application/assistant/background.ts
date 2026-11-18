import "server-only";
import { scheduleAfterResponse } from "@/server/infrastructure/after-response";

/**
 * Work a turn starts but its reply never waits for: storing what the model call used and
 * naming a new conversation. Each task is started at once and its failure is logged, so
 * nothing here can fail or slow a reply.
 *
 * A serverless instance may be frozen as soon as the response has been sent, so every
 * turn also asks the platform to keep the request alive until its work has finished
 * (`keepAliveUntilTurnEnds`). That request is answered when the response ends, which on
 * Stop or a dropped connection is before the turn has wound down and started its work. So
 * the turn itself counts as work in progress until it says it has ended: the wait cannot
 * finish in the gap between "the response is over" and "the usage write has started".
 */

const pending = new Set<Promise<void>>();

function track(work: Promise<void>): void {
  pending.add(work);
  void work.finally(() => pending.delete(work));
}

/** Start `task` without waiting for it. A throw or rejection is logged under `label`. */
export function runInBackground(label: string, task: () => Promise<unknown>): void {
  track(
    (async () => {
      try {
        await task();
      } catch (err) {
        console.error(`[assistant] ${label} failed:`, err);
      }
    })(),
  );
}

/**
 * Resolves once no background work is left, including work started while waiting. After
 * the last task finishes it looks once more a moment later, for work that the end of a
 * stream was just about to start.
 */
export async function backgroundWorkSettled(): Promise<void> {
  do {
    while (pending.size > 0) await Promise.all([...pending]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } while (pending.size > 0);
}

/**
 * The longest a turn is counted as still running: the ceiling the assistant routes give a
 * request (`maxDuration`). A turn always reports its end (its stream finishes or is
 * cancelled); this only stops a request being held open for good if that report is
 * somehow never made.
 */
export const TURN_HOLD_MAX_MS = 5 * 60_000;

/**
 * Keep the current request alive, after its response has been sent, until this turn has
 * ended and the work it started has finished. Returns the function the turn calls when it
 * has ended, after it has started whatever it is going to start; calling it more than once
 * is harmless. Outside a request (tests, scripts) there is nothing to keep alive and the
 * work simply runs to its end.
 */
export function keepAliveUntilTurnEnds(): () => void {
  let end: () => void = () => {};
  const running = new Promise<void>((resolve) => {
    end = resolve;
  });
  const timer = setTimeout(end, TURN_HOLD_MAX_MS);
  // The cap must not keep a finished script or test run from exiting.
  timer.unref?.();
  track(running.then(() => clearTimeout(timer)));
  scheduleAfterResponse(backgroundWorkSettled);
  return end;
}
