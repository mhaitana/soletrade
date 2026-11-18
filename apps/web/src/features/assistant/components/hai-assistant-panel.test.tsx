import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HaiAssistantPanel } from "@/features/assistant/components/hai-assistant-panel";
import {
  deleteConversationAction,
  listPanelConversationsAction,
  loadPanelConversationAction,
} from "@/features/assistant/api/actions";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard", refresh: vi.fn() }));
const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ refresh: navigation.refresh }),
}));
vi.mock("@/features/assistant/api/actions", () => ({
  listPanelConversationsAction: vi.fn(),
  loadPanelConversationAction: vi.fn(),
  deleteConversationAction: vi.fn(),
}));
vi.mock("@/features/assistant/hooks/use-hai-tool-navigation", () => ({
  useHaiToolNavigation: () => undefined,
  toolCallIdsOf: () => new Set<string>(),
  HaiToolPart: () => null,
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({ messages: [], status: "ready", error: undefined, ...chat }),
}));

const SALES = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const conversations = [
  { id: SALES, title: "How is my business doing this month?", updatedAt: new Date() },
  { id: INVOICE, title: "Draft an invoice for a customer", updatedAt: new Date() },
];

let desktop = false;
beforeEach(() => {
  desktop = false;
  navigation.pathname = "/dashboard";
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(listPanelConversationsAction).mockResolvedValue(conversations as never);
  vi.mocked(deleteConversationAction).mockResolvedValue({ ok: true });
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
    within(dialog).getByRole("button", { name: "History" }).focus();
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

describe("Assistant history", () => {
  async function openHistory(user: ReturnType<typeof userEvent.setup>) {
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    await user.click(within(dialog).getByRole("button", { name: "History" }));
    const list = await within(dialog).findByRole("list", { name: "Conversations" });
    return { dialog, list };
  }

  it("lists conversations inside the panel and opens one in the panel's chat", async () => {
    vi.mocked(loadPanelConversationAction).mockResolvedValue({
      id: INVOICE,
      messages: [
        { id: "m1", role: "user", content: "Draft an invoice for a customer", parts: null },
        { id: "m2", role: "assistant", content: "Which customer?", parts: null },
      ],
    });
    const user = userEvent.setup();
    const { dialog, list } = await openHistory(user);

    // History replaces the chat inside the same dialog; the panel does not close.
    expect(within(dialog).getByRole("heading", { name: "History" })).toHaveFocus();
    expect(within(dialog).queryByRole("textbox", { name: "Message hAI" })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);

    await user.click(
      within(list).getByRole("button", { name: /^Draft an invoice for a customer/ }),
    );

    const input = await within(dialog).findByRole("textbox", { name: "Message hAI" });
    expect(loadPanelConversationAction).toHaveBeenCalledWith({ conversationId: INVOICE });
    expect(chat.setMessages).toHaveBeenCalledWith([
      {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "Draft an invoice for a customer" }],
      },
      { id: "m2", role: "assistant", parts: [{ type: "text", text: "Which customer?" }] },
    ]);
    // A reload brings the same conversation back, and focus stays off the composer so a
    // phone does not raise its keyboard over the conversation.
    expect(window.sessionStorage.getItem("hai-panel-conversation")).toBe(INVOICE);
    expect(input).not.toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "History" })).toHaveFocus();
  });

  it("keeps the list open and says so when a conversation no longer exists", async () => {
    vi.mocked(loadPanelConversationAction).mockResolvedValue(null);
    const user = userEvent.setup();
    const { dialog, list } = await openHistory(user);

    await user.click(
      within(list).getByRole("button", { name: /^Draft an invoice for a customer/ }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "That conversation is no longer available.",
    );
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(chat.setMessages).not.toHaveBeenCalled();
  });

  it("deletes a conversation only after confirming", async () => {
    const user = userEvent.setup();
    const { dialog, list } = await openHistory(user);

    await user.click(
      within(list).getByRole("button", {
        name: "Delete conversation How is my business doing this month?",
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Delete this conversation?" });
    expect(deleteConversationAction).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(1));
    expect(deleteConversationAction).toHaveBeenCalledWith({ conversationId: SALES });
    // The deleted row's button is gone, so focus lands on the view's heading.
    await waitFor(() =>
      expect(within(dialog).getByRole("heading", { name: "History" })).toHaveFocus(),
    );
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("refreshes the assistant page's own list after deleting from the panel", async () => {
    navigation.pathname = "/assistant";
    const user = userEvent.setup();
    const { list } = await openHistory(user);

    await user.click(
      within(list).getByRole("button", {
        name: "Delete conversation Draft an invoice for a customer",
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Delete this conversation?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
  });

  it("offers a retry when the conversations cannot be loaded", async () => {
    vi.mocked(listPanelConversationsAction).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    await user.click(within(dialog).getByRole("button", { name: "History" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Your conversations could not be loaded.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    const list = await within(dialog).findByRole("list", { name: "Conversations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("goes back to the chat, and reopens on the chat after closing from History", async () => {
    const user = userEvent.setup();
    const { dialog } = await openHistory(user);

    await user.click(within(dialog).getByRole("button", { name: "Back to chat" }));
    expect(within(dialog).getByRole("textbox", { name: "Message hAI" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "History" }));
    await user.click(await within(dialog).findByRole("button", { name: "Close hAI" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const reopened = await screen.findByRole("dialog", { name: "hAI global assistant" });
    expect(within(reopened).getByRole("textbox", { name: "Message hAI" })).toBeInTheDocument();
  });

  it("links to the assistant page for the conversation the panel is showing", async () => {
    const user = userEvent.setup();
    const { dialog } = await openHistory(user);
    expect(within(dialog).getByRole("link", { name: "Open full page" })).toHaveAttribute(
      "href",
      "/assistant",
    );
  });
});
