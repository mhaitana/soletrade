import { useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HaiAssistantPanel } from "@/features/assistant/components/hai-assistant-panel";
import { publishHaiEvent } from "@/features/assistant/hooks/use-hai-events";
import {
  deleteConversationAction,
  listConversationsAction,
  loadPanelConversationAction,
  setWriteEnabledAction,
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
  listConversationsAction: vi.fn(),
  loadPanelConversationAction: vi.fn(),
  deleteConversationAction: vi.fn(),
  setWriteEnabledAction: vi.fn(),
}));
// What the panel tells the navigation hook has already run, render by render, and the
// tool calls a loaded conversation is said to contain.
const toolCalls = vi.hoisted(() => ({
  inLoaded: new Set<string>(),
  settledSeen: [] as ReadonlySet<string>[],
}));
vi.mock("@/features/assistant/hooks/use-hai-tool-navigation", () => ({
  useHaiToolNavigation: (_messages: unknown, settled: ReadonlySet<string>) => {
    toolCalls.settledSeen.push(settled);
  },
  toolCallIdsOf: () => toolCalls.inLoaded,
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
  toolCalls.inLoaded = new Set<string>();
  toolCalls.settledSeen.length = 0;
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(listConversationsAction).mockResolvedValue({
    conversations: conversations as never,
    hasMore: false,
  });
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

function Harness({ ask }: { ask?: { id: number; question?: string; send?: boolean } }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen((value) => !value)}>
        Open assistant
      </button>
      <button>Workspace action</button>
      <HaiAssistantPanel open={open} onOpenChange={setOpen} returnFocusRef={triggerRef} ask={ask} />
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
      title: "Draft an invoice for a customer",
      writeEnabled: true,
      feedback: {},
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

  it("shows a conversation's write-tools state and asks before turning them on", async () => {
    vi.mocked(loadPanelConversationAction).mockResolvedValue({
      id: INVOICE,
      title: "Draft an invoice for a customer",
      writeEnabled: false,
      feedback: {},
      messages: [{ id: "m1", role: "user", content: "Draft an invoice", parts: null }],
    });
    vi.mocked(setWriteEnabledAction).mockResolvedValue({ ok: true, enabled: true });
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    // A chat with no conversation yet has nothing to switch.
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "History" }));
    const list = await within(dialog).findByRole("list", { name: "Conversations" });
    await user.click(
      within(list).getByRole("button", { name: /^Draft an invoice for a customer/ }),
    );

    const toggle = await within(dialog).findByRole("switch", { name: "Write tools off" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(setWriteEnabledAction).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("dialog", { name: /Turn on write tools/ });
    await user.click(within(confirm).getByRole("button", { name: "Turn on" }));

    await waitFor(() =>
      expect(setWriteEnabledAction).toHaveBeenCalledWith({
        conversationId: INVOICE,
        enabled: true,
      }),
    );
    expect(await within(dialog).findByRole("switch", { name: "Write tools on" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
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

  it("tells the assistant page when a conversation is deleted from the panel", async () => {
    const heard: unknown[] = [];
    const listen = (event: Event) => heard.push((event as CustomEvent).detail);
    window.addEventListener("hai:event", listen);
    const user = userEvent.setup();
    const { list } = await openHistory(user);

    await user.click(
      within(list).getByRole("button", {
        name: "Delete conversation Draft an invoice for a customer",
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Delete this conversation?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(heard).toEqual([
        { source: "panel", event: { type: "conversation-deleted", id: INVOICE } },
      ]),
    );
    window.removeEventListener("hai:event", listen);
  });

  it("loads older conversations on request and searches by title", async () => {
    const OLDER = "33333333-3333-4333-8333-333333333333";
    vi.mocked(listConversationsAction).mockImplementation(async (input) => {
      const { search, offset } = (input ?? {}) as { search?: string; offset?: number };
      if (search) {
        return {
          conversations: conversations.filter((c) =>
            c.title.toLowerCase().includes(search.toLowerCase()),
          ) as never,
          hasMore: false,
        };
      }
      if (offset) {
        return {
          conversations: [
            { id: OLDER, title: "Who are my recent customers?", updatedAt: new Date() },
          ] as never,
          hasMore: false,
        };
      }
      return { conversations: conversations as never, hasMore: true };
    });
    const user = userEvent.setup();
    const { dialog, list } = await openHistory(user);

    await user.click(within(dialog).getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(listConversationsAction).toHaveBeenLastCalledWith({ search: undefined, offset: 2 });
    expect(within(dialog).queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();

    await user.type(
      within(dialog).getByRole("searchbox", { name: "Search conversations" }),
      "invoice",
    );
    await waitFor(() =>
      expect(listConversationsAction).toHaveBeenLastCalledWith({ search: "invoice" }),
    );
    await waitFor(() =>
      expect(
        within(within(dialog).getByRole("list", { name: "Conversations" })).getAllByRole(
          "listitem",
        ),
      ).toHaveLength(1),
    );
  });

  it("offers a retry when the conversations cannot be loaded", async () => {
    vi.mocked(listConversationsAction).mockRejectedValueOnce(new Error("offline"));
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

describe("Questions asked from elsewhere in the app", () => {
  it("sends the question as a new conversation", () => {
    render(<Harness ask={{ id: 1, question: "Summarise this invoice", send: true }} />);

    // The chat is emptied first, so the question never lands in an unrelated conversation.
    expect(chat.setMessages).toHaveBeenCalledWith([]);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Summarise this invoice" });
  });

  it("sends each new request once, even with the same wording", () => {
    const { rerender } = render(<Harness ask={{ id: 1, question: "Again", send: true }} />);
    rerender(<Harness ask={{ id: 1, question: "Again", send: true }} />);
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);

    rerender(<Harness ask={{ id: 2, question: "Again", send: true }} />);
    expect(chat.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("leaves a question that is not to be sent in the input", async () => {
    const user = userEvent.setup();
    render(<Harness ask={{ id: 1, question: "Draft a reminder for Acme" }} />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));

    expect(await screen.findByRole("textbox", { name: "Message hAI" })).toHaveValue(
      "Draft a reminder for Acme",
    );
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });
});

describe("A conversation that is still loading", () => {
  const stored = {
    id: INVOICE,
    title: "Draft an invoice for a customer",
    writeEnabled: false,
    feedback: {},
    messages: [{ id: "m1", role: "user" as const, content: "Draft an invoice", parts: null }],
  };

  it("is dropped when the person goes back before it arrives", async () => {
    let arrive!: (value: typeof stored) => void;
    vi.mocked(loadPanelConversationAction).mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open assistant" }));
    const dialog = await screen.findByRole("dialog", { name: "hAI global assistant" });
    await user.click(within(dialog).getByRole("button", { name: "History" }));
    const list = await within(dialog).findByRole("list", { name: "Conversations" });
    await user.click(
      within(list).getByRole("button", { name: /^Draft an invoice for a customer/ }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Back to chat" }));
    await act(async () => arrive(stored));

    // The chat the person went back to is left as it was.
    expect(chat.setMessages).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("hai-panel-conversation")).toBeNull();
    expect(within(dialog).getByRole("textbox", { name: "Message hAI" })).toBeInTheDocument();
  });

  it("restored after a reload does not replace a question asked in the meantime", async () => {
    let arrive!: (value: typeof stored) => void;
    vi.mocked(loadPanelConversationAction).mockReturnValue(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    window.sessionStorage.setItem("hai-panel-conversation", INVOICE);
    render(<Harness ask={{ id: 1, question: "Summarise this invoice", send: true }} />);
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Summarise this invoice" });
    chat.setMessages.mockClear();

    await act(async () => arrive(stored));

    expect(chat.setMessages).not.toHaveBeenCalled();
  });
});

describe("A conversation restored into the panel", () => {
  beforeEach(() => {
    window.sessionStorage.setItem("hai-panel-conversation", INVOICE);
    toolCalls.inLoaded = new Set(["call-1"]);
    vi.mocked(loadPanelConversationAction).mockResolvedValue({
      id: INVOICE,
      title: "Draft an invoice for a customer",
      writeEnabled: false,
      feedback: {},
      messages: [{ id: "m1", role: "user", content: "Open overdue invoices", parts: null }],
    });
  });

  it("keeps its finished actions marked as run when a question is asked from elsewhere", async () => {
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(chat.setMessages).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toolCalls.settledSeen.at(-1)?.has("call-1")).toBe(true));
    const restoredAt = toolCalls.settledSeen.length;

    rerender(<Harness ask={{ id: 1, question: "Summarise this invoice", send: true }} />);
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "Summarise this invoice" });

    // The old messages stay on screen for a render before the chat is emptied. Had the
    // list been cleared first, their navigation would have run a second time.
    for (const settled of toolCalls.settledSeen.slice(restoredAt)) {
      expect(settled.has("call-1")).toBe(true);
    }
  });

  it("is reloaded when the assistant page adds to it", async () => {
    render(<Harness />);
    await waitFor(() => expect(chat.setMessages).toHaveBeenCalledTimes(1));

    act(() => publishHaiEvent("page", { type: "conversation-updated", id: INVOICE }));
    await waitFor(() => expect(loadPanelConversationAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(chat.setMessages).toHaveBeenCalledTimes(2));

    // Another conversation changing is none of this panel's business.
    act(() => publishHaiEvent("page", { type: "conversation-updated", id: SALES }));
    expect(loadPanelConversationAction).toHaveBeenCalledTimes(2);
  });
});
