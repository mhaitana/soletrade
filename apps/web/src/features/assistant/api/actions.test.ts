// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireWorkspaceContext } from "@/server/application/auth/workspace-context";
import {
  getConversation,
  listConversationFeedback,
  listConversationPage,
  setMessageFeedback,
} from "@/server/application/assistant/services";
import { getInstalledModules } from "@/server/foundation/module-installations/index";
import { branded } from "@/types/ids";
import {
  listConversationsAction,
  loadAssistantPage,
  loadPanelConversationAction,
  setMessageFeedbackAction,
} from "@/features/assistant/api/actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/application/auth/workspace-context", () => ({
  requireWorkspaceContext: vi.fn(),
}));
vi.mock("@/server/application/assistant/services", () => ({
  deleteConversation: vi.fn(),
  getConversation: vi.fn(),
  listConversationFeedback: vi.fn(),
  listConversationPage: vi.fn(),
  renameConversation: vi.fn(),
  setConversationWriteEnabled: vi.fn(),
  setMessageFeedback: vi.fn(),
}));
vi.mock("@/server/foundation/module-installations/index", () => ({
  getInstalledModules: vi.fn(),
}));

const WORKSPACE_ID = branded<"WorkspaceId">("00000000-0000-4000-8000-0000000000b1");
const USER_ID = branded<"UserId">("00000000-0000-4000-8000-0000000000b2");
const CONVERSATION_ID = "00000000-0000-4000-8000-0000000000b3";
const MESSAGE_ID = "00000000-0000-4000-8000-0000000000b4";

const conversation = {
  id: CONVERSATION_ID,
  title: "How is my business doing?",
  updatedAt: new Date("2026-11-18T09:00:00Z"),
  writeEnabled: true,
  messages: [
    {
      id: MESSAGE_ID,
      role: "assistant",
      content: "Sales are up.",
      parts: null,
      createdAt: new Date("2026-11-18T09:00:00Z"),
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWorkspaceContext).mockResolvedValue({
    workspaceId: WORKSPACE_ID,
    role: "owner",
    user: { id: USER_ID, email: "owner@example.test" },
  });
  vi.mocked(listConversationPage).mockResolvedValue({ conversations: [], hasMore: false });
  vi.mocked(getConversation).mockResolvedValue(conversation as never);
  vi.mocked(listConversationFeedback).mockResolvedValue({ [MESSAGE_ID]: "up" });
  vi.mocked(getInstalledModules).mockResolvedValue(["books"]);
});

describe("listConversationsAction", () => {
  it("lists for the signed-in member in the session's workspace, never ids from the caller", async () => {
    await listConversationsAction({
      search: "  invoice ",
      offset: 50,
      workspaceId: "someone-else",
    });

    expect(listConversationPage).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, {
      search: "invoice",
      offset: 50,
    });
  });

  it("returns nothing for input that is not a search and an offset", async () => {
    expect(await listConversationsAction({ offset: -1 })).toEqual({
      conversations: [],
      hasMore: false,
    });
    expect(await listConversationsAction({ search: "x".repeat(81) })).toEqual({
      conversations: [],
      hasMore: false,
    });
    expect(listConversationPage).not.toHaveBeenCalled();
  });
});

describe("loadPanelConversationAction", () => {
  it("returns the conversation with the member's own ratings", async () => {
    const loaded = await loadPanelConversationAction({ conversationId: CONVERSATION_ID });

    expect(getConversation).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, CONVERSATION_ID);
    expect(listConversationFeedback).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, CONVERSATION_ID);
    expect(loaded).toMatchObject({
      id: CONVERSATION_ID,
      writeEnabled: true,
      feedback: { [MESSAGE_ID]: "up" },
    });
  });

  it("still opens the conversation when the ratings cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listConversationFeedback).mockRejectedValue(new Error("relation does not exist"));

    const loaded = await loadPanelConversationAction({ conversationId: CONVERSATION_ID });

    expect(loaded).toMatchObject({ id: CONVERSATION_ID, feedback: {} });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("is null for a conversation that is not this member's, and for a malformed id", async () => {
    vi.mocked(getConversation).mockResolvedValue(null);
    expect(await loadPanelConversationAction({ conversationId: CONVERSATION_ID })).toBeNull();

    expect(await loadPanelConversationAction({ conversationId: "not-a-uuid" })).toBeNull();
    expect(getConversation).toHaveBeenCalledTimes(1);
  });
});

describe("loadAssistantPage", () => {
  it("offers receipt attachments only with Books installed and the right to add them", async () => {
    expect((await loadAssistantPage({})).canAttachReceipts).toBe(true);

    vi.mocked(getInstalledModules).mockResolvedValue(["invoices"]);
    expect((await loadAssistantPage({})).canAttachReceipts).toBe(false);

    vi.mocked(getInstalledModules).mockResolvedValue(["books"]);
    vi.mocked(requireWorkspaceContext).mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      role: "readonly",
      user: { id: USER_ID, email: "viewer@example.test" },
    });
    expect((await loadAssistantPage({})).canAttachReceipts).toBe(false);
  });

  it("opens the page without ratings when they cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listConversationFeedback).mockRejectedValue(new Error("relation does not exist"));

    const page = await loadAssistantPage({ conversationId: CONVERSATION_ID });

    expect(page.activeConversation).toMatchObject({ id: CONVERSATION_ID });
    expect(page.feedback).toEqual({});
    logged.mockRestore();
  });
});

describe("setMessageFeedbackAction", () => {
  it("rates as the signed-in member in the session's workspace", async () => {
    vi.mocked(setMessageFeedback).mockResolvedValue("saved");

    const result = await setMessageFeedbackAction({
      messageId: MESSAGE_ID,
      rating: "down",
      comment: "  wrong total ",
    });

    expect(result).toEqual({ ok: true });
    expect(setMessageFeedback).toHaveBeenCalledWith(WORKSPACE_ID, USER_ID, {
      messageId: MESSAGE_ID,
      rating: "down",
      comment: "wrong total",
    });
  });

  it("refuses malformed input without touching the database", async () => {
    for (const input of [
      { messageId: "nope", rating: "up" },
      { messageId: MESSAGE_ID, rating: "sideways" },
      { messageId: MESSAGE_ID, rating: "down", comment: "x".repeat(1001) },
    ]) {
      expect(await setMessageFeedbackAction(input)).toEqual({
        ok: false,
        error: "Invalid request.",
      });
    }
    expect(setMessageFeedback).not.toHaveBeenCalled();
  });

  it("says so when the reply is not one this member can rate", async () => {
    vi.mocked(setMessageFeedback).mockResolvedValue("not-found");

    expect(await setMessageFeedbackAction({ messageId: MESSAGE_ID, rating: "up" })).toEqual({
      ok: false,
      error: "That reply is no longer available.",
    });
  });
});
