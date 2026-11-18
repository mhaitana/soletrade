// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { forEachSettled } from "@/server/infrastructure/for-each-settled";

vi.mock("server-only", () => ({}));

describe("forEachSettled", () => {
  it("keeps going after a failure and counts the successes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    const succeeded = await forEachSettled([1, 2, 3, 4, 5], 2, "test.job", async (n) => {
      if (n === 2) throw new Error("boom");
      seen.push(n);
    });
    expect(succeeded).toBe(4);
    expect(seen.sort()).toEqual([1, 3, 4, 5]);
    expect(error).toHaveBeenCalledWith("[test.job] item failed", expect.any(Error));
    error.mockRestore();
  });

  it("never runs more than the given number of tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await forEachSettled(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      "test.job",
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
      },
    );
    expect(peak).toBe(3);
  });

  it("does nothing for an empty list", async () => {
    const task = vi.fn();
    await expect(forEachSettled([], 5, "test.job", task)).resolves.toBe(0);
    expect(task).not.toHaveBeenCalled();
  });
});
