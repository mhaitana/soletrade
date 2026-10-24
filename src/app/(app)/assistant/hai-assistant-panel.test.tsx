import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HaiAssistantPanel } from "./hai-assistant-panel";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("./use-hai-tool-navigation", () => ({
  useHaiToolNavigation: () => undefined,
  HaiToolPart: () => null,
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: [],
    status: "ready",
    sendMessage: vi.fn(),
    stop: vi.fn(),
    setMessages: vi.fn(),
    error: undefined,
  }),
}));

let desktop = false;
beforeEach(() => {
  desktop = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: desktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

function Harness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen((value) => !value)}>
        Open assistant
      </button>
      <button>Workspace action</button>
      <HaiAssistantPanel open={open} onOpenChange={setOpen} returnFocusRef={triggerRef} />
    </>
  );
}

describe("Assistant keyboard access", () => {
  it("focuses the mobile dialog, closes with Escape and returns focus without losing a draft", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open assistant" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const input = within(dialog).getByRole("textbox", { name: "Message hAI" });
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "Keep this unsent draft");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "Message hAI" })).toHaveValue(
      "Keep this unsent draft",
    );
  });

  it("keeps keyboard focus inside the mobile overlay", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    // History is the last focusable control; Tab must wrap into the panel.
    within(dialog).getByRole("link", { name: "History" }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.queryByRole("button", { name: "Workspace action" })).not.toBeInTheDocument();
  });

  it("keeps the desktop workspace usable while the assistant stays open", async () => {
    desktop = true;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    expect(dialog).not.toHaveAttribute("aria-modal", "true");
    const workspace = screen.getByRole("button", { name: "Workspace action" });
    await user.click(workspace);
    expect(workspace).toHaveFocus();
    expect(dialog).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close hAI" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
