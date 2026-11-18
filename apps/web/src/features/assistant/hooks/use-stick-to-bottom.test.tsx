import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStickToBottom } from "@/features/assistant/hooks/use-stick-to-bottom";

/** jsdom lays nothing out, so the scroll geometry is supplied by the test. */
function size(element: HTMLElement, scrollHeight: number, clientHeight = 100) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
}

function Thread({ shown = true, viewKey }: { shown?: boolean; viewKey?: string }) {
  const { attach, onScroll, follow } = useStickToBottom<HTMLDivElement>(viewKey);
  const [lines, setLines] = useState(["first"]);
  return (
    <>
      <button onClick={() => setLines((current) => [...current, "more"])}>grow</button>
      <button onClick={follow}>follow</button>
      {shown ? (
        <div data-testid="thread" ref={attach} onScroll={onScroll}>
          {lines.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}

const flush = () => act(async () => {});

beforeEach(() => {
  // Every list is already 500 tall when it mounts.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStickToBottom", () => {
  it("starts on the newest message even when the list mounts after the hook", () => {
    // The side panel's dialog mounts its content after the panel component's effects ran.
    const { rerender } = render(<Thread shown={false} />);
    rerender(<Thread />);

    expect(screen.getByTestId("thread").scrollTop).toBe(500);
  });

  it("follows content that grows, until the person scrolls up", async () => {
    render(<Thread />);
    const thread = screen.getByTestId("thread");

    size(thread, 800);
    act(() => screen.getByRole("button", { name: "grow" }).click());
    await flush();
    expect(thread.scrollTop).toBe(800);

    // Scrolled up to read something earlier: new content must not pull the view down.
    thread.scrollTop = 100;
    thread.dispatchEvent(new Event("scroll", { bubbles: true }));
    size(thread, 1200);
    act(() => screen.getByRole("button", { name: "grow" }).click());
    await flush();
    expect(thread.scrollTop).toBe(100);

    // Sending a message goes back to following.
    act(() => screen.getByRole("button", { name: "follow" }).click());
    size(thread, 1500);
    act(() => screen.getByRole("button", { name: "grow" }).click());
    await flush();
    expect(thread.scrollTop).toBe(1500);
  });

  it("returns to the newest message when the view is shown again", () => {
    const { rerender } = render(<Thread viewKey="open:chat" />);
    const thread = screen.getByTestId("thread");
    size(thread, 500);
    thread.scrollTop = 0;
    thread.dispatchEvent(new Event("scroll", { bubbles: true }));

    rerender(<Thread viewKey="open:chat:again" />);
    expect(thread.scrollTop).toBe(500);
  });
});
