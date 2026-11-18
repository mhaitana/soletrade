// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.hoisted(() => ({ tasks: [] as (() => Promise<void>)[], inRequest: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/infrastructure/after-response", () => ({
  // Stands in for Next's `after`: keeps the task so a test can run it when it chooses.
  scheduleAfterResponse: (task: () => Promise<void>) => {
    if (!after.inRequest) return false;
    after.tasks.push(task);
    return true;
  },
}));

import {
  backgroundWorkSettled,
  keepAliveUntilTurnEnds,
  runInBackground,
  TURN_HOLD_MAX_MS,
} from "@/server/application/assistant/background";

/** A task that finishes when the test says so. */
function controlled() {
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { task: () => done, finish };
}

/** Whether `promise` has settled yet, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  return done;
}

beforeEach(() => {
  after.tasks = [];
  after.inRequest = true;
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await backgroundWorkSettled();
});

describe("background work", () => {
  it("starts a task at once and waits for it only when asked to", async () => {
    const work = controlled();
    let started = false;
    runInBackground("test work", () => {
      started = true;
      return work.task();
    });
    expect(started).toBe(true);

    const all = backgroundWorkSettled();
    expect(await settled(all)).toBe(false);
    work.finish();
    await all;
  });

  it("logs a failing task under its label and never rejects", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    runInBackground("recording usage", async () => {
      throw new Error("ledger down");
    });
    runInBackground("naming the conversation", () => {
      throw new Error("thrown before any await");
    });
    await expect(backgroundWorkSettled()).resolves.toBeUndefined();
    expect(errors).toHaveBeenCalledWith("[assistant] recording usage failed:", expect.any(Error));
    expect(errors).toHaveBeenCalledWith(
      "[assistant] naming the conversation failed:",
      expect.any(Error),
    );
  });

  it("waits for work that was started while it was waiting", async () => {
    const first = controlled();
    const second = controlled();
    runInBackground("first", first.task);
    const all = backgroundWorkSettled();
    runInBackground("second", second.task);
    first.finish();
    expect(await settled(all)).toBe(false);
    second.finish();
    await all;
  });
});

describe("keeping a request alive for a turn", () => {
  it("asks the platform to wait for the background work", () => {
    const end = keepAliveUntilTurnEnds();
    expect(after.tasks).toHaveLength(1);
    end();
  });

  it("covers work the turn starts after the response has already ended", async () => {
    // Stop, or a dropped connection: the platform runs the after-response task while the
    // turn is still winding down and has not started its usage write yet.
    const end = keepAliveUntilTurnEnds();
    const keptAlive = after.tasks[0]!();
    expect(await settled(keptAlive)).toBe(false);

    // The turn winds down: it starts the usage write, then says it has ended.
    const usageWrite = controlled();
    runInBackground("recording usage", usageWrite.task);
    end();
    expect(await settled(keptAlive)).toBe(false);

    usageWrite.finish();
    await keptAlive;
  });

  it("covers work started a moment after the turn said it had ended", async () => {
    const end = keepAliveUntilTurnEnds();
    const keptAlive = after.tasks[0]!();
    const late = controlled();
    end();
    // Started by a callback that runs right after the end, before the wait has looked again.
    queueMicrotask(() => runInBackground("recording usage", late.task));
    expect(await settled(keptAlive)).toBe(false);
    late.finish();
    await keptAlive;
  });

  it("does not hold the request for ever if a turn never reports its end", async () => {
    vi.useFakeTimers();
    keepAliveUntilTurnEnds();
    const keptAlive = after.tasks[0]!();
    let done = false;
    void keptAlive.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(TURN_HOLD_MAX_MS - 1_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true);
  });

  it("lets the turn report its end more than once", async () => {
    const end = keepAliveUntilTurnEnds();
    end();
    end();
    await after.tasks[0]!();
  });

  it("works outside a request, where there is nothing to keep alive", async () => {
    after.inRequest = false;
    const end = keepAliveUntilTurnEnds();
    expect(after.tasks).toEqual([]);
    const work = controlled();
    runInBackground("recording usage", work.task);
    end();
    work.finish();
    await backgroundWorkSettled();
  });
});
