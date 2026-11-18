import "server-only";

/**
 * Run `task` for every item, at most `concurrency` at a time. A failing item is logged
 * under `label` and does not stop the others. Returns how many items succeeded.
 *
 * For scheduled jobs that have already changed a batch of rows and now owe each one its
 * follow-up work (event, audit row, email): a plain loop stopped at the first error and
 * left every later row without it, and those rows are not picked up again.
 */
export async function forEachSettled<T>(
  items: readonly T[],
  concurrency: number,
  label: string,
  task: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  let succeeded = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        await task(item);
        succeeded += 1;
      } catch (error) {
        console.error(`[${label}] item failed`, error);
      }
    }
  };
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return succeeded;
}
