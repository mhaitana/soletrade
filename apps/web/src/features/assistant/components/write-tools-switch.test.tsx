import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WriteToolsSwitch } from "@/features/assistant/components/write-tools-switch";
import { setWriteEnabledAction } from "@/features/assistant/api/actions";

vi.mock("@/features/assistant/api/actions", () => ({ setWriteEnabledAction: vi.fn() }));

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WriteToolsSwitch", () => {
  it("asks before turning on, and returns focus to the switch when cancelled", async () => {
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(
      <WriteToolsSwitch conversationId={FIRST} enabled={false} onEnabledChange={onEnabledChange} />,
    );
    const toggle = screen.getByRole("switch", { name: "Write tools off" });

    await user.click(toggle);
    const confirm = await screen.findByRole("dialog", { name: /Turn on write tools/ });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(setWriteEnabledAction).not.toHaveBeenCalled();
    expect(onEnabledChange).not.toHaveBeenCalled();
    // The dialog has no trigger of its own; without this, focus fell to the page body.
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it("puts the switch back when the server did not take the change", async () => {
    vi.mocked(setWriteEnabledAction).mockResolvedValue({ ok: false, error: "nope" });
    const onEnabledChange = vi.fn();
    const user = userEvent.setup();
    render(<WriteToolsSwitch conversationId={FIRST} enabled onEnabledChange={onEnabledChange} />);

    await user.click(screen.getByRole("switch", { name: "Write tools on" }));

    await waitFor(() => expect(onEnabledChange.mock.calls).toEqual([[false], [true]]));
  });

  it("does not put it back on a different conversation opened in the meantime", async () => {
    let fail!: () => void;
    vi.mocked(setWriteEnabledAction).mockReturnValue(
      new Promise((_, reject) => {
        fail = () => reject(new Error("offline"));
      }),
    );
    const first = vi.fn();
    const second = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <WriteToolsSwitch conversationId={FIRST} enabled onEnabledChange={first} />,
    );

    await user.click(screen.getByRole("switch", { name: "Write tools on" }));
    expect(first).toHaveBeenCalledWith(false);

    // Another conversation is now on screen when the request fails.
    rerender(<WriteToolsSwitch conversationId={SECOND} enabled={false} onEnabledChange={second} />);
    fail();

    await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });
});
