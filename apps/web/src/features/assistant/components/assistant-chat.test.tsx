import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantChat } from "@/features/assistant/components/assistant-chat";
import {
  deleteConversationAction,
  loadPanelConversationAction,
  setMessageFeedbackAction,
  type AssistantPageData,
} from "@/features/assistant/api/actions";
import { publishHaiEvent } from "@/features/assistant/hooks/use-hai-events";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const chat = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  stop: vi.fn(),
  setMessages: vi.fn(),
  clearError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/assistant/api/actions", () => ({
  listConversationsAction: vi.fn(),
  loadPanelConversationAction: vi.fn(),
  deleteConversationAction: vi.fn(),
  renameConversationAction: vi.fn(),
  setWriteEnabledAction: vi.fn(),
  setMessageFeedbackAction: vi.fn(),
}));
vi.mock("@/features/assistant/hooks/use-hai-tool-navigation", () => ({
  useHaiToolNavigation: () => undefined,
  toolCallIdsOf: () => new Set<string>(),
  HaiToolPart: () => null,
}));
const chatState = vi.hoisted(() => ({ status: "ready" }));
vi.mock("@ai-sdk/react", () => ({
  useChat: (options: { messages?: unknown[] }) => ({
    messages: options.messages ?? [],
    status: chatState.status,
    error: undefined,
    ...chat,
  }),
}));

const SALES = "11111111-1111-4111-8111-111111111111";
const INVOICE = "22222222-2222-4222-8222-222222222222";
const conversations = [
  { id: SALES, title: "How is my business doing this month?", updatedAt: new Date() },
  { id: INVOICE, title: "Draft an invoice for a customer", updatedAt: new Date() },
] as unknown as AssistantPageData["conversations"];

const openSales = {
  ...conversations[0]!,
  writeEnabled: false,
  messages: [
    {
      id: "m1",
      role: "user",
      content: "How is my business doing this month?",
      parts: null,
      createdAt: new Date(),
    },
  ],
} as unknown as AssistantPageData["activeConversation"];

beforeEach(() => {
  vi.clearAllMocks();
  chatState.status = "ready";
  vi.mocked(deleteConversationAction).mockResolvedValue({ ok: true });
});

describe("Assistant page", () => {
  it("has the workspace page header and lists conversations with the open one marked", () => {
    render(<AssistantChat initialConversations={conversations} activeConversation={openSales} />);

    expect(screen.getByRole("heading", { level: 1, name: "hAI assistant" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New conversation" })).toHaveAttribute(
      "href",
      "/assistant",
    );

    const list = screen.getByRole("navigation", { name: "Conversations" });
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", `/assistant?c=${SALES}`);
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[0]).toHaveTextContent("Open now");
    expect(links[1]).not.toHaveAttribute("aria-current");

    // The chat card is titled with the conversation, one level under the page title.
    expect(
      screen.getByRole("heading", { level: 2, name: "How is my business doing this month?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Last active/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename conversation" })).toBeEnabled();
  });

  it("starts a new conversation from a suggested prompt", async () => {
    const user = userEvent.setup();
    render(<AssistantChat initialConversations={conversations} activeConversation={null} />);

    expect(screen.getByRole("heading", { level: 2, name: "New conversation" })).toBeInTheDocument();
    // Write tools need a saved conversation, and there is nothing to rename yet.
    expect(screen.getByRole("switch", { name: /Write tools off/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Rename conversation" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "List my overdue invoices" }));
    expect(chat.sendMessage).toHaveBeenCalledWith({ text: "List my overdue invoices" });
  });

  it("deletes another conversation after confirming and refreshes the list", async () => {
    const user = userEvent.setup();
    render(<AssistantChat initialConversations={conversations} activeConversation={openSales} />);

    await user.click(
      screen.getByRole("button", { name: "Delete conversation Draft an invoice for a customer" }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Delete this conversation?" });
    expect(deleteConversationAction).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(deleteConversationAction).toHaveBeenCalledWith({ conversationId: INVOICE });
    expect(router.push).not.toHaveBeenCalled();
  });

  it("returns to a new conversation when the open one is deleted", async () => {
    const user = userEvent.setup();
    render(<AssistantChat initialConversations={conversations} activeConversation={openSales} />);

    await user.click(
      screen.getByRole("button", {
        name: "Delete conversation How is my business doing this month?",
      }),
    );
    const confirm = await screen.findByRole("dialog", { name: "Delete this conversation?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/assistant"));
  });

  it("shows what the side panel added to the conversation on screen", async () => {
    vi.mocked(loadPanelConversationAction).mockResolvedValue({
      id: SALES,
      title: "How is my business doing this month?",
      writeEnabled: true,
      feedback: {},
      messages: [
        { id: "m1", role: "user", content: "How is my business doing?", parts: null },
        { id: "m2", role: "assistant", content: "Sales are up.", parts: null },
      ],
    });
    render(<AssistantChat initialConversations={conversations} activeConversation={openSales} />);

    act(() => publishHaiEvent("panel", { type: "conversation-updated", id: SALES }));

    // The list is re-read from the server, and the open conversation is loaded again.
    expect(router.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(chat.setMessages).toHaveBeenCalledWith([
        { id: "m1", role: "user", parts: [{ type: "text", text: "How is my business doing?" }] },
        { id: "m2", role: "assistant", parts: [{ type: "text", text: "Sales are up." }] },
      ]),
    );
    expect(await screen.findByRole("switch", { name: "Write tools on" })).toBeInTheDocument();
  });

  it("only refreshes the list when the panel worked on a different conversation", () => {
    render(<AssistantChat initialConversations={conversations} activeConversation={openSales} />);

    act(() => publishHaiEvent("panel", { type: "conversation-updated", id: INVOICE }));

    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(loadPanelConversationAction).not.toHaveBeenCalled();
  });

  it("leaves a conversation the side panel deleted", () => {
    render(<AssistantChat initialConversations={conversations} activeConversation={openSales} />);

    act(() => publishHaiEvent("panel", { type: "conversation-deleted", id: SALES }));

    expect(router.push).toHaveBeenCalledWith("/assistant");
  });

  it("records a thumbs down on a reply, then the note on what was wrong", async () => {
    const REPLY = "33333333-3333-4333-8333-333333333333";
    vi.mocked(setMessageFeedbackAction).mockResolvedValue({ ok: true });
    const withReply = {
      ...openSales!,
      messages: [
        ...openSales!.messages,
        {
          id: REPLY,
          role: "assistant",
          content: "Sales are up.",
          parts: null,
          createdAt: new Date(),
        },
      ],
    } as unknown as AssistantPageData["activeConversation"];
    const user = userEvent.setup();
    render(
      <AssistantChat
        initialConversations={conversations}
        activeConversation={withReply}
        initialFeedback={{ [REPLY]: "up" }}
      />,
    );

    // The stored rating shows; pressing the other thumb changes it.
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Bad answer" }));
    expect(setMessageFeedbackAction).toHaveBeenCalledWith({
      messageId: REPLY,
      rating: "down",
      comment: undefined,
    });
    expect(screen.getByRole("button", { name: "Bad answer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.type(
      screen.getByRole("textbox", { name: /What was wrong with this answer/ }),
      "The total was wrong",
    );
    await user.click(screen.getByRole("button", { name: "Send note" }));
    await waitFor(() =>
      expect(setMessageFeedbackAction).toHaveBeenLastCalledWith({
        messageId: REPLY,
        rating: "down",
        comment: "The total was wrong",
      }),
    );
    expect(await screen.findByText("Thanks, noted.")).toBeInTheDocument();
  });

  it("puts a rating back when it could not be saved", async () => {
    const REPLY = "33333333-3333-4333-8333-333333333333";
    vi.mocked(setMessageFeedbackAction).mockResolvedValue({ ok: false, error: "nope" });
    const withReply = {
      ...openSales!,
      messages: [
        {
          id: REPLY,
          role: "assistant",
          content: "Sales are up.",
          parts: null,
          createdAt: new Date(),
        },
      ],
    } as unknown as AssistantPageData["activeConversation"];
    const user = userEvent.setup();
    render(<AssistantChat initialConversations={conversations} activeConversation={withReply} />);

    await user.click(screen.getByRole("button", { name: "Good answer" }));

    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("uploads an attached receipt and sends its file id with the message", async () => {
    const FILE = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/files/upload-url"
        ? new Response(JSON.stringify({ fileId: FILE, uploadUrl: "https://storage.test/put" }))
        : new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(
      <AssistantChat
        initialConversations={conversations}
        activeConversation={null}
        canAttachReceipts
      />,
    );

    const receipt = new File(["%PDF"], "fuel.pdf", { type: "application/pdf" });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, receipt);

    // Uploaded through the normal files flow, as a receipt; nothing is read yet.
    expect(await screen.findByRole("button", { name: "Remove fuel.pdf" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/upload-url",
      expect.objectContaining({
        body: JSON.stringify({
          fileName: "fuel.pdf",
          mimeType: "application/pdf",
          sizeBytes: receipt.size,
          entityType: "receipt",
        }),
      }),
    );

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Add this expense");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(chat.sendMessage).toHaveBeenCalledWith({
      text: `Add this expense\n\nAttached receipt: fuel.pdf (file id ${FILE})`,
    });
    expect(screen.queryByRole("button", { name: "Remove fuel.pdf" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("refuses a file that is not an image or PDF, and offers no paperclip without Books", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { container, unmount } = render(
      <AssistantChat
        initialConversations={conversations}
        activeConversation={null}
        canAttachReceipts
      />,
    );
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["x"], "notes.txt", { type: "text/plain" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Receipts must be an image or PDF.");
    unmount();

    render(<AssistantChat initialConversations={conversations} activeConversation={null} />);
    expect(screen.queryByRole("button", { name: "Attach a receipt" })).not.toBeInTheDocument();
  });

  it("does not refresh on the panel's activity while its own reply is arriving", () => {
    chatState.status = "streaming";
    render(<AssistantChat initialConversations={conversations} activeConversation={null} />);

    // A refresh now could remount a conversation that is still being created; the page
    // refreshes itself when its turn ends.
    act(() => publishHaiEvent("panel", { type: "conversation-updated", id: INVOICE }));
    act(() => publishHaiEvent("panel", { type: "conversation-deleted", id: INVOICE }));

    expect(router.refresh).not.toHaveBeenCalled();
    expect(loadPanelConversationAction).not.toHaveBeenCalled();
  });

  it("keeps a removed receipt removed when its upload finishes afterwards", async () => {
    let finishUpload!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishUpload = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const { container } = render(
      <AssistantChat
        initialConversations={conversations}
        activeConversation={null}
        canAttachReceipts
      />,
    );
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(["%PDF"], "fuel.pdf", { type: "application/pdf" }),
    );
    await user.click(await screen.findByRole("button", { name: "Remove fuel.pdf" }));
    // Focus goes back to the paperclip; the removed chip took the focused button with it.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Attach a receipt" })).toHaveFocus(),
    );

    await act(async () => {
      finishUpload(
        new Response(JSON.stringify({ fileId: SALES, uploadUrl: "https://storage.test/put" })),
      );
    });

    expect(screen.queryByRole("button", { name: "Remove fuel.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    // The upload was abandoned before the file itself was sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("puts back the earlier rating, not no rating, when a change could not be saved", async () => {
    const REPLY = "33333333-3333-4333-8333-333333333333";
    vi.mocked(setMessageFeedbackAction).mockResolvedValue({ ok: false, error: "nope" });
    const withReply = {
      ...openSales!,
      messages: [
        {
          id: REPLY,
          role: "assistant",
          content: "Sales are up.",
          parts: null,
          createdAt: new Date(),
        },
      ],
    } as unknown as AssistantPageData["activeConversation"];
    const user = userEvent.setup();
    render(
      <AssistantChat
        initialConversations={conversations}
        activeConversation={withReply}
        initialFeedback={{ [REPLY]: "up" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Bad answer" }));

    expect(await screen.findByText(/could not be saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good answer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Bad answer" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows a title changed elsewhere instead of the one it loaded with", () => {
    const { rerender } = render(
      <AssistantChat initialConversations={conversations} activeConversation={openSales} />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "How is my business doing this month?" }),
    ).toBeInTheDocument();

    // The list refreshes with the title hAI wrote after the first reply.
    const retitled = [
      { ...conversations[0]!, title: "November sales check" },
      conversations[1]!,
    ] as unknown as AssistantPageData["conversations"];
    rerender(<AssistantChat initialConversations={retitled} activeConversation={openSales} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "November sales check" }),
    ).toBeInTheDocument();
  });

  it("lists the open conversation even when it is older than the listed ones", () => {
    const older = {
      ...openSales!,
      id: "55555555-5555-4555-8555-555555555555",
      title: "An older conversation",
    } as unknown as AssistantPageData["activeConversation"];
    render(<AssistantChat initialConversations={conversations} activeConversation={older} />);

    const links = within(screen.getByRole("navigation", { name: "Conversations" })).getAllByRole(
      "link",
    );
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent("An older conversation");
    expect(links[0]).toHaveAttribute("aria-current", "page");
  });

  it("says so when there are no conversations yet", () => {
    render(<AssistantChat initialConversations={[]} activeConversation={null} />);

    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Conversations" })).not.toBeInTheDocument();
    // The shortcut to the list is only offered when there is a list.
    expect(screen.queryByRole("link", { name: /^Conversations/ })).not.toBeInTheDocument();
  });
});
